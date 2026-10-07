import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  sign,
} from 'node:crypto';
import { connect } from 'node:http2';

const base64url = (value: unknown) =>
  Buffer.from(JSON.stringify(value)).toString('base64url');
export class DeliveryError extends Error {
  constructor(
    readonly code: string,
    readonly permanent = false,
  ) {
    super(code);
  }
}

@Injectable()
export class NotificationProviders {
  private googleToken?: { value: string; expires: number };
  constructor(private readonly config: ConfigService) {}
  private key() {
    const key = Buffer.from(
      this.config.getOrThrow<string>('RUNTIME_TOKEN_ENCRYPTION_KEY'),
      'base64',
    );
    if (key.length !== 32)
      throw new Error('La clave de cifrado debe tener 32 bytes');
    return key;
  }
  encrypt(token: string) {
    const iv = randomBytes(12),
      cipher = createCipheriv('aes-256-gcm', this.key(), iv);
    const value = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
    return [iv, cipher.getAuthTag(), value]
      .map((x) => x.toString('base64'))
      .join('.');
  }
  decrypt(value: string) {
    const [iv, tag, payload] = value
      .split('.')
      .map((x) => Buffer.from(x, 'base64'));
    const decipher = createDecipheriv('aes-256-gcm', this.key(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(payload), decipher.final()]).toString(
      'utf8',
    );
  }
  async push(
    platform: 'android' | 'ios',
    token: string,
    notification: {
      intentId: string;
      rideId: string;
      kind: string;
      expiresAt: Date;
      recipientId?: string;
    },
  ): Promise<string> {
    const title =
      notification.kind === 'safety'
        ? 'KROW · Atención de seguridad'
        : 'KROW · Actualización de viaje';
    const body =
      notification.kind === 'proximity'
        ? 'Tu parada está cerca. Abre el viaje para ver la información actual.'
        : 'Hay una actualización importante. Abre el viaje para consultarla.';
    const data = {
      intentId: notification.intentId,
      rideId: notification.rideId,
      kind: notification.kind,
      expiresAt: String(notification.expiresAt.getTime()),
      ...(notification.recipientId
        ? { recipientId: notification.recipientId }
        : {}),
    };
    if (platform === 'android') {
      const project = this.config.getOrThrow<string>('FCM_PROJECT_ID');
      const response = await fetch(
        `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(project)}/messages:send`,
        {
          method: 'POST',
          signal: AbortSignal.timeout(5000),
          headers: {
            Authorization: `Bearer ${await this.fcmToken()}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            message: {
              token,
              data,
              android: {
                priority: 'HIGH',
                ttl: `${Math.max(0, Math.floor((notification.expiresAt.getTime() - Date.now()) / 1000))}s`,
              },
            },
          }),
        },
      );
      const result = (await response.json()) as {
        name?: string;
        error?: { details?: Array<{ errorCode?: string }> };
      };
      if (!response.ok)
        throw new DeliveryError(
          result.error?.details?.find((d) => d.errorCode)?.errorCode ??
            `fcm_${response.status}`,
          result.error?.details?.some((d) => d.errorCode === 'UNREGISTERED') ??
            false,
        );
      return result.name ?? notification.intentId;
    }
    const now = Math.floor(Date.now() / 1000),
      keyId = this.config.getOrThrow<string>('APNS_KEY_ID'),
      teamId = this.config.getOrThrow<string>('APNS_TEAM_ID');
    const message = `${base64url({ alg: 'ES256', kid: keyId })}.${base64url({ iss: teamId, iat: now })}`;
    const signature = sign('sha256', Buffer.from(message), {
      key: this.config
        .getOrThrow<string>('APNS_PRIVATE_KEY')
        .replace(/\\n/g, '\n'),
      dsaEncoding: 'ieee-p1363',
    }).toString('base64url');
    return new Promise((resolve, reject) => {
      const sandbox = this.config.get('APNS_SANDBOX') === 'true';
      const client = connect(
        sandbox
          ? 'https://api.sandbox.push.apple.com'
          : 'https://api.push.apple.com',
      );
      let settled = false;
      const finish = (error?: DeliveryError, id?: string) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        client.close();
        if (error) reject(error);
        else resolve(id ?? notification.intentId);
      };
      const timer = setTimeout(() => {
        client.destroy();
        finish(new DeliveryError('apns_timeout'));
      }, 5000);
      client.on('error', () => finish(new DeliveryError('apns_transport')));
      const request = client.request({
        ':method': 'POST',
        ':path': `/3/device/${token}`,
        authorization: `bearer ${message}.${signature}`,
        'apns-topic': this.config.getOrThrow<string>('APNS_BUNDLE_ID'),
        'apns-push-type': 'alert',
        'apns-priority': '10',
        'apns-expiration': String(
          Math.floor(notification.expiresAt.getTime() / 1000),
        ),
        'apns-collapse-id': notification.intentId,
      });
      let status = 0,
        id = '',
        response = '';
      request.on('response', (headers) => {
        status = Number(headers[':status']);
        id = String(headers['apns-id'] ?? '');
      });
      request.on('data', (chunk: Buffer) => {
        response += chunk.toString();
      });
      request.on('error', () => finish(new DeliveryError('apns_request')));
      request.on('end', () => {
        if (status === 200) finish(undefined, id);
        else {
          let reason = `apns_${status}`;
          try {
            reason = (JSON.parse(response) as { reason: string }).reason;
          } catch {
            /* retain bounded status code */
          }
          finish(
            new DeliveryError(
              reason,
              ['Unregistered', 'BadDeviceToken'].includes(reason),
            ),
          );
        }
      });
      request.end(
        JSON.stringify({
          aps: {
            alert: { title, body },
            sound: 'default',
            category: 'KROW_TRIP',
            'interruption-level': 'time-sensitive',
          },
          ...data,
        }),
      );
    });
  }
  private async fcmToken() {
    if (this.googleToken && this.googleToken.expires > Date.now() + 60000)
      return this.googleToken.value;
    const email = this.config.getOrThrow<string>('FCM_CLIENT_EMAIL'),
      key = this.config
        .getOrThrow<string>('FCM_PRIVATE_KEY')
        .replace(/\\n/g, '\n'),
      now = Math.floor(Date.now() / 1000);
    const content = `${base64url({ alg: 'RS256', typ: 'JWT' })}.${base64url({ iss: email, scope: 'https://www.googleapis.com/auth/firebase.messaging', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 })}`;
    const assertion = `${content}.${sign('RSA-SHA256', Buffer.from(content), key).toString('base64url')}`;
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      signal: AbortSignal.timeout(5000),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion,
      }),
    });
    if (!response.ok) throw new DeliveryError('fcm_credentials');
    const result = (await response.json()) as {
      access_token: string;
      expires_in: number;
    };
    this.googleToken = {
      value: result.access_token,
      expires: Date.now() + result.expires_in * 1000,
    };
    return result.access_token;
  }
  async escalate(incidentId: string, level: number) {
    const routingKey = this.config.getOrThrow<string>(
      level === 0
        ? 'PAGERDUTY_PRIMARY_KEY'
        : level === 1
          ? 'PAGERDUTY_BACKUP_KEY'
          : 'PAGERDUTY_SUPERVISOR_KEY',
    );
    const response = await fetch('https://events.pagerduty.com/v2/enqueue', {
      method: 'POST',
      signal: AbortSignal.timeout(5000),
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        routing_key: routingKey,
        event_action: 'trigger',
        dedup_key: `krow:${incidentId}:${level}`,
        payload: {
          summary: 'Incidente de seguridad KROW pendiente de atención',
          source: 'krow-runtime',
          severity: 'critical',
          custom_details: { incidentId },
        },
      }),
    });
    if (!response.ok) throw new DeliveryError('pagerduty_unavailable');
  }
  async sms(to: string, body: string) {
    const account = this.config.getOrThrow<string>('TWILIO_ACCOUNT_SID'),
      token = this.config.getOrThrow<string>('TWILIO_AUTH_TOKEN');
    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(account)}/Messages.json`,
      {
        method: 'POST',
        signal: AbortSignal.timeout(5000),
        headers: {
          Authorization: `Basic ${Buffer.from(`${account}:${token}`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          To: to,
          From: this.config.getOrThrow<string>('TWILIO_FROM'),
          Body: body,
        }),
      },
    );
    if (!response.ok) throw new DeliveryError('twilio_unavailable');
  }
}
