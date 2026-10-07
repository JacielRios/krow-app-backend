function publicHttpsUrl(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

const email = process.env.NEXT_PUBLIC_SUPPORT_EMAIL?.trim();
export const publicConfig = {
  supportEmail:
    email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null,
  supportUrl: publicHttpsUrl(process.env.NEXT_PUBLIC_SUPPORT_URL),
  privacyUrl: publicHttpsUrl(process.env.NEXT_PUBLIC_PRIVACY_URL),
  termsUrl: publicHttpsUrl(process.env.NEXT_PUBLIC_TERMS_URL),
  androidDownloadUrl: publicHttpsUrl(
    process.env.NEXT_PUBLIC_ANDROID_DOWNLOAD_URL,
  ),
};

export function contactDraft(
  email: string,
  values: { name: string; sender: string; topic: string; message: string },
) {
  const query = new URLSearchParams({
    subject: `KROW · ${values.topic}`,
    body: `Nombre: ${values.name}\nCorreo de respuesta: ${values.sender}\n\n${values.message}`,
  });
  return `mailto:${email}?${query}`;
}
