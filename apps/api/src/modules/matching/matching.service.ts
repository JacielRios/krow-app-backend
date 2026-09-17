import { Injectable } from '@nestjs/common';

export interface GeoPoint {
  lat: number;
  lng: number;
}

@Injectable()
export class MatchingService {
  score(
    requestedOrigin: GeoPoint | undefined,
    requestedDestination: GeoPoint | undefined,
    rideOrigin: GeoPoint,
    rideDestination: GeoPoint,
  ) {
    const originDistanceKm = requestedOrigin
      ? this.haversine(requestedOrigin, rideOrigin)
      : 0;
    const destinationDistanceKm = requestedDestination
      ? this.haversine(requestedDestination, rideDestination)
      : 0;
    return {
      score: Math.max(0, 100 - (originDistanceKm + destinationDistanceKm) * 5),
      originDistanceKm,
      destinationDistanceKm,
    };
  }

  private haversine(a: GeoPoint, b: GeoPoint): number {
    const radians = (degrees: number) => (degrees * Math.PI) / 180;
    const earthKm = 6371;
    const dLat = radians(b.lat - a.lat);
    const dLng = radians(b.lng - a.lng);
    const value =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(radians(a.lat)) *
        Math.cos(radians(b.lat)) *
        Math.sin(dLng / 2) ** 2;
    return earthKm * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
  }
}
