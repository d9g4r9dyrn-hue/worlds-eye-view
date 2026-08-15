/**
 * Where on Earth the sun is rising or setting, right now.
 *
 * The obvious implementation is to compute the terminator as a great
 * circle and look for cameras near it. This does something simpler and
 * more exact: it asks, for each camera, how high the sun is in that
 * camera's own sky. A camera watching a sunset is one where the sun sits
 * within a couple of degrees of its horizon and is on the way down. No
 * terminator geometry, no projection, and it stays correct at the poles
 * and across the antimeridian, both of which a great-circle test has to
 * special-case.
 *
 * Positions come from the standard low-precision solar formulae (the
 * NOAA/Astronomical Almanac approximation). They're good to roughly a
 * hundredth of a degree over the modern era — several orders of magnitude
 * better than needed to answer "is the sun low in the sky here", which is
 * a question with a fuzzy boundary anyway: atmospheric refraction alone
 * moves the apparent horizon by about half a degree.
 */

const DEG = Math.PI / 180;

/** Days from the J2000.0 epoch (2000-01-01 12:00 UTC) to `date`. */
function julianDaysSinceJ2000(date: Date): number {
  return date.getTime() / 86_400_000 - 10_957.5;
}

export interface SolarPosition {
  /** Degrees above the horizon. Negative is below. */
  altitudeDeg: number;
  /**
   * True when the sun is climbing — i.e. local morning. Derived from the
   * sign of the hour angle rather than by sampling the altitude twice,
   * so it stays exact right at the solstice-latitude edge cases where a
   * finite difference gets noisy.
   */
  rising: boolean;
}

/**
 * The sun's apparent position from a point on the ground.
 *
 * `lat`/`lon` in degrees, east-positive.
 */
export function solarPosition(lat: number, lon: number, date: Date): SolarPosition {
  const d = julianDaysSinceJ2000(date);

  // Mean longitude and mean anomaly of the sun.
  const meanLongitude = (280.460 + 0.9856474 * d) % 360;
  const meanAnomaly = ((357.528 + 0.9856003 * d) % 360) * DEG;

  // Ecliptic longitude — mean longitude corrected for the eccentricity of
  // Earth's orbit (the equation of the centre).
  const eclipticLongitude =
    (meanLongitude + 1.915 * Math.sin(meanAnomaly) + 0.020 * Math.sin(2 * meanAnomaly)) * DEG;

  // Obliquity of the ecliptic, slowly decreasing.
  const obliquity = (23.439 - 0.0000004 * d) * DEG;

  const declination = Math.asin(Math.sin(obliquity) * Math.sin(eclipticLongitude));

  // Right ascension, kept in the same quadrant as the ecliptic longitude.
  const rightAscension = Math.atan2(
    Math.cos(obliquity) * Math.sin(eclipticLongitude),
    Math.cos(eclipticLongitude)
  );

  // Greenwich mean sidereal time, in degrees.
  const gmst = (280.46061837 + 360.98564736629 * d) % 360;

  // Local hour angle: how far the sun is from due south, positive to the
  // west. Normalised to (-180, 180] so the sign is meaningful — negative
  // is before local solar noon (morning), positive is after.
  let hourAngle = gmst + lon - rightAscension / DEG;
  hourAngle = ((((hourAngle + 180) % 360) + 360) % 360) - 180;

  const latRad = lat * DEG;
  const hourAngleRad = hourAngle * DEG;

  const altitude = Math.asin(
    Math.sin(latRad) * Math.sin(declination) +
      Math.cos(latRad) * Math.cos(declination) * Math.cos(hourAngleRad)
  );

  return { altitudeDeg: altitude / DEG, rising: hourAngle < 0 };
}

export type SunPhase = "sunrise" | "sunset";

/**
 * How near the horizon counts as "at sunrise/sunset".
 *
 * Wide enough to always find cameras — the band has to sweep past enough
 * of the catalogue's uneven coverage to land on some — and narrow enough
 * that the light is genuinely golden rather than merely daytime. The
 * band is asymmetric about zero on purpose: the good light continues
 * well after the sun is geometrically down (civil twilight runs to -6°)
 * but turns to ordinary daylight quickly once it's up.
 */
export const SUN_BAND_DEG = { min: -6, max: 4 };

export function isAtPhase(position: SolarPosition, phase: SunPhase): boolean {
  if (position.altitudeDeg < SUN_BAND_DEG.min || position.altitudeDeg > SUN_BAND_DEG.max) {
    return false;
  }
  return phase === "sunrise" ? position.rising : !position.rising;
}

/**
 * Ranks by how close to the horizon the sun is — 0 at dead level, 1 at
 * the edge of the band. Lets a caller prefer the most photogenic cameras
 * when it has more candidates than slots.
 */
export function phaseScore(position: SolarPosition): number {
  const span = position.altitudeDeg >= 0 ? SUN_BAND_DEG.max : Math.abs(SUN_BAND_DEG.min);
  return Math.min(1, Math.abs(position.altitudeDeg) / span);
}
