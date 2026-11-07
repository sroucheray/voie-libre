import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { CopernicusElevationProvider } from './copernicus-provider';

const directory = join(__dirname, '../../../../data/relief');
// Needs the tiles of scripts/download-relief.sh: skipped when they are not on this machine.
const available = existsSync(
  join(directory, 'Copernicus_DSM_COG_10_N45_00_E003_00_DEM.tif'),
);

(available ? describe : describe.skip)('Copernicus tiles (real data)', () => {
  const provider = new CopernicusElevationProvider(directory);

  it('gives plausible elevations around Clermont-Ferrand', async () => {
    const [clermont, puyDeDome] = await provider.elevations([
      { lon: 3.087, lat: 45.7772 }, // Place de Jaude, about 400 m
      { lon: 2.9643, lat: 45.7725 }, // Puy de Dôme summit, 1465 m
    ]);
    expect(clermont).toBeGreaterThan(350);
    expect(clermont).toBeLessThan(450);
    expect(puyDeDome).toBeGreaterThan(1400);
    expect(puyDeDome).toBeLessThan(1500);
  });

  it('reads a few thousand points quickly', async () => {
    const points = Array.from({ length: 5000 }, (_, i) => ({
      lon: 3.0 + (i % 100) * 0.005,
      lat: 45.5 + Math.floor(i / 100) * 0.005,
    }));
    const started = Date.now();
    const values = await provider.elevations(points);
    expect(values.every((v) => v !== null)).toBe(true);
    expect(Date.now() - started).toBeLessThan(5000);
  });
});
