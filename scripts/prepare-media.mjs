import { mkdir, readdir, readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import installer from '@ffmpeg-installer/ffmpeg';
import sharp from 'sharp';

const out = path.resolve('public/media');
const ffmpeg = process.env.FFMPEG_PATH || installer.path;

// Times are in the two real 24 fps cuts, not in the 10 s reference.
const films = {
  desktop: { input: 'video-cabrales-home-scroll-web.mp4', width: 1440, crf: 27, posters: [0, 7.5, 15.5, 21.75, 22.5] },
  mobile: { input: 'video-cabrales-home-scroll-mobile.mp4', width: 720, crf: 29, posters: [0, 7.5, 15.5, 21.75, 22.5] },
};
const loops = {
  // Frame 0 matches the scroll opening; frame 68 is the closest late return.
  desktop: { input: 'loop-cafe-desktop.mp4', width: 1280, frames: 69, dissolve: 8, crf: 22 },
  mobile: { input: 'loop-cafe-mobile-1080x1920.mp4', width: 720, frames: 100, dissolve: 11, crf: 25 },
};
const motionFrames = ['cafe', 'molido', 'super', 'origenes', 'reunion'];

function run(args, pipe = false) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpeg, ['-hide_banner', '-loglevel', 'error', ...args], {
      windowsHide: true, stdio: ['ignore', pipe ? 'pipe' : 'ignore', 'pipe'],
    });
    const chunks = [], errors = [];
    child.stdout?.on('data', (chunk) => chunks.push(chunk));
    child.stderr.on('data', (chunk) => errors.push(chunk));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve(Buffer.concat(chunks));
      else reject(new Error(Buffer.concat(errors).toString() || `FFmpeg terminó con el código ${code}`));
    });
  });
}

async function frame(input, seconds, width) {
  return run(['-ss', String(seconds), '-i', input, '-frames:v', '1', '-an', '-vf', `scale=${width}:-2:flags=lanczos`, '-f', 'image2pipe', '-vcodec', 'png', '-'], true);
}

async function encodeFilm(variant, film) {
  await run([
    '-y', '-i', film.input, '-an', '-vf', `scale=${film.width}:-2:flags=lanczos`,
    '-c:v', 'libx264', '-preset', 'slow', '-crf', String(film.crf),
    '-pix_fmt', 'yuv420p', '-g', '1', '-bf', '0', '-movflags', '+faststart',
    path.join(out, `cabrales-scroll-${variant}.mp4`),
  ]);
}

async function encodeLoop(variant, { input, width, frames, dissolve, crf }) {
  // Preserve frame zero for the scroll handoff and gently return to it at the seam.
  const mix = `clip((N-${frames - dissolve})/${dissolve - 1},0,1)`;
  const filter = [
    `[0:v]scale=${width}:-2:flags=lanczos,setsar=1,split[clip][opening]`,
    `[clip]trim=end_frame=${frames},setpts=PTS-STARTPTS[body]`,
    '[opening]trim=end_frame=1,setpts=PTS-STARTPTS,loop=-1:1:0[still]',
    `[body][still]blend=all_expr='A*(1-${mix})+B*${mix}':shortest=1[out]`,
  ].join(';');
  await run([
    '-y', '-i', input, '-filter_complex', filter, '-map', '[out]', '-an', '-frames:v', String(frames),
    '-c:v', 'libx264', '-preset', 'slow', '-crf', String(crf), '-pix_fmt', 'yuv420p',
    '-g', '48', '-movflags', '+faststart', path.join(out, `cabrales-loop-${variant}.mp4`),
  ]);
}

async function productCrops() {
  const mock = (await readdir('.')).find((file) => file.startsWith('Home idea') && file.endsWith('.png'));
  if (!mock) throw new Error('No se encontró el mock de Home idea.');
  const products = [
    { name: 'brasil', left: 140, top: 3129, width: 69, height: 155 },
    { name: 'colombia', left: 363, top: 3184, width: 76, height: 152 },
    { name: 'peru', left: 996, top: 3183, width: 77, height: 154 },
    { name: 'prestige', left: 1224, top: 3129, width: 86, height: 158 },
  ];
  for (const { name, ...crop } of products) {
    const { data, info } = await sharp(mock).extract(crop).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    // Remove the ivory card surface from the mock crop, retaining its soft shadows.
    for (let i = 0; i < data.length; i += 4) {
      if (name === 'colombia' && i / 4 % info.width < 9 && i / 4 < info.width * 16) {
        data[i + 3] = 0;
        continue;
      }
      const min = Math.min(data[i], data[i + 1], data[i + 2]);
      const warm = data[i] >= data[i + 1] - 4 && data[i + 1] >= data[i + 2] - 4;
      const luma = data[i] * 0.2126 + data[i + 1] * 0.7152 + data[i + 2] * 0.0722;
      if (warm && min > 172 && data[i] - data[i + 2] < 45) {
        data[i + 3] = Math.round(255 * Math.max(0, Math.min(1, (234 - luma) / 40)));
      }
    }
    await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } })
      .resize({ height: 232 })
      .webp({ quality: 88 })
      .toFile(path.join(out, `pack-${name}.webp`));
  }
}

await mkdir(out, { recursive: true });

const loopOnly = process.argv.includes('--solo-loop-desktop') ? 'desktop'
  : process.argv.includes('--solo-loop-movil') ? 'mobile' : undefined;
if (loopOnly) {
  await encodeLoop(loopOnly, loops[loopOnly]);
  process.exit(0);
}

const desktopVideoOption = process.argv.indexOf('--solo-video-desktop');
if (desktopVideoOption !== -1) {
  const input = process.argv[desktopVideoOption + 1];
  if (input?.startsWith('--')) throw new Error('Usá --solo-video-desktop [ruta-del-video].');
  await encodeFilm('desktop', input ? { ...films.desktop, input, crf: 24 } : films.desktop);
  process.exit(0);
}

if (process.argv.includes('--inspeccion')) {
  const inspection = path.resolve('reports/media');
  await mkdir(inspection, { recursive: true });
  const times = [0, 1.25, 3.5, 5, 6.25, 7.5, 8.75, 10, 11.25, 12.5, 14, 15.5, 17, 18.5, 20, 21.75, 22.5];
  for (const [variant, film] of Object.entries(films)) {
    const width = variant === 'desktop' ? 360 : 172;
    const height = variant === 'desktop' ? 202 : 306;
    const cols = variant === 'desktop' ? 4 : 6;
    const overlays = [];
    for (const [index, time] of times.entries()) {
      const left = (index % cols) * width;
      const top = Math.floor(index / cols) * (height + 24);
      const png = await frame(film.input, time, width);
      overlays.push({ input: await sharp(png).resize(width, height, { fit: 'fill' }).png().toBuffer(), left, top });
      overlays.push({ input: Buffer.from(`<svg width="${width}" height="24"><text x="8" y="17" fill="#fff7ed" font-size="14" font-family="sans-serif">${time} s</text></svg>`), left, top: top + height });
    }
    await sharp({ create: { width: cols * width, height: Math.ceil(times.length / cols) * (height + 24), channels: 3, background: '#291a13' } })
      .composite(overlays).jpeg({ quality: 89 }).toFile(path.join(inspection, `${variant}.jpg`));
  }
} else {
  const onlyStills = process.argv.includes('--solo-imagenes');
  await productCrops();
  for (const [variant, film] of Object.entries(films)) {
    if (!onlyStills) await encodeFilm(variant, film);
    for (const [index, cut] of motionFrames.entries()) {
      const png = await frame(film.input, film.posters[index], film.width);
      await sharp(png).webp({ quality: index === 0 ? 84 : 80 }).toFile(path.join(out, `${cut}-${variant}.webp`));
      if (variant === 'desktop' && index === 0) {
        await sharp(png).resize(1200, 630, { fit: 'cover' }).jpeg({ quality: 88, mozjpeg: true }).toFile(path.join(out, 'cabrales-social.jpg'));
      }
    }
  }
}

// The supplied brand mark in the previous implementation is reused, not altered there.
const logoAt = process.env.CABRALES_LOGO_PATH || 'D:/dxp_cabrales/my-astro-project/public/images/cabrales-logo.png';
try {
  const logo = await readFile(logoAt);
  await sharp(logo).trim({ background: '#00000000', threshold: 8 }).resize({ width: 220 }).webp({ lossless: true }).toFile(path.join(out, 'cabrales-logo.webp'));
  // Crop the cup from the wordmark to keep the favicon recognizable at 32 px.
  const cropped = await sharp(logo).trim({ background: '#00000000', threshold: 8 }).png().toBuffer({ resolveWithObject: true });
  const { width, height } = cropped.info;
  const cup = { left: Math.round(width * .31), top: 0, width: Math.round(width * .38), height: Math.round(height * .57) };
  await sharp(cropped.data).extract(cup).trim({ background: '#00000000', threshold: 8 }).resize(64, 64, {
    fit: 'contain', background: '#00000000',
  }).png().toFile(path.join(out, 'cabrales-icon.png'));
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
  console.log('Logo: se conservan los archivos ya preparados de public/media/. Para regenerarlos, indicá CABRALES_LOGO_PATH.');
}
