import { DEFAULT_MARKS, SCENE_IDS, validMarks, type SceneId } from './timeline.ts';

export const HOME_SLUG = 'cabrales-home-v2';
export const SCENE_BLOCK = 'cabrales-home-v2-scene';
export const PRODUCT_BLOCK = 'cabrales-home-v2-product';
export const PORTRAIT_QUERY = '(max-aspect-ratio: 1/1)';

export interface Blok {
  component: string;
  _uid?: string;
  _editable?: string;
  [field: string]: unknown;
}

export interface Action { label: string; href: string }
export interface Artwork { src: string; alt: string }
export interface Product {
  id: string; name: string; note: string; image: Artwork; link: Action; blok?: Blok;
}
export interface Scene {
  id: SceneId; anchor: string; script: string; title: string; kicker: string; description: string;
  actions: Action[]; desktop: Artwork; mobile: Artwork; blok?: Blok;
}

const STORE = 'https://tienda.cabrales.com';
const SITE = 'https://www.cabrales.com';
const BUY_SUPER = `${STORE}/productos/cafe-tostado-molido-super-cabrales/`;
const HISTORY = `${SITE}/sobre-cabrales/`;
const SHOP = `${STORE}/cafe-molido/`;
const EMAIL = 'cafe@cabrales.com';

const art = (file: string, alt = '') => ({ src: `/media/${file}`, alt });
const action = (label: string, href: string) => ({ label, href });

const DEFAULT_SCENES: Omit<Scene, 'desktop' | 'mobile'>[] = [
  {
    id: 'cafe', anchor: 'inicio', script: 'Café', title: 'Cabrales',
    kicker: 'Mar del Plata, desde 1941',
    description: 'Historia, pasión y familia en cada grano que tostamos.',
    actions: [action('Ver productos', '#productos'), action('Nuestra historia', HISTORY)],
  },
  {
    id: 'molido', anchor: 'molido', script: 'Molido', title: 'para cada forma de preparar',
    kicker: '', description: 'Molido, en grano, cápsulas, instantáneo y en saquitos.',
    actions: [action('Productos', '#productos')],
  },
  {
    id: 'super', anchor: 'super-cabrales', script: 'Súper', title: 'Cabrales',
    kicker: 'Café tostado molido', description: 'Una taza de carácter y con buen cuerpo.',
    actions: [action('Comprar', BUY_SUPER), action('Ver más', `${SITE}/productos/cafe-tostado-molido-super-cabrales-x-500-grs`)],
  },
  {
    id: 'origenes', anchor: 'productos', script: 'Un origen', title: 'para cada taza',
    kicker: 'Brasil, Colombia, Perú y Prestige', description: '',
    actions: [action('Ver todos los cafés', SHOP)],
  },
  {
    id: 'reunion', anchor: 'reunion', script: 'Lo que sigue', title: 'en una reunión',
    kicker: '', description: 'Agendemos una reunión y te mostramos la presentación completa del sitio.',
    actions: [action('Agendar reunión', `mailto:${EMAIL}?subject=Reuni%C3%B3n%20sobre%20Cabrales`)],
  },
];

const DEFAULT_PRODUCTS = [
  { id: 'brasil', name: 'Brasil', note: 'Notas a chocolate y frutos secos.' },
  { id: 'colombia', name: 'Colombia', note: 'Frutal y achocolatado, de altura.' },
  { id: 'peru', name: 'Perú', note: 'Suave y dulce.' },
  { id: 'prestige', name: 'Prestige', note: 'Calidad superior para el día a día.' },
];

const DEFAULT_TITLE = 'Café Cabrales | Historia, pasión y familia desde 1941';
const DEFAULT_DESCRIPTION = 'Del grano al café molido. Conocé Súper Cabrales y encontrá un origen para cada taza.';

function object(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function blocks(value: unknown, component: string): Blok[] {
  return Array.isArray(value) ? value.filter((item): item is Blok => object(item)?.component === component) : [];
}

function text(value: unknown, fallback = '') {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

export function safeHref(value: unknown) {
  const href = text(value);
  if (/[\u0000-\u0020\u007f\\]/.test(href)) return '';
  if (/^\/(?!\/)/.test(href) || /^#[a-zA-Z][\w-]*$/.test(href)) return href;
  if (/^mailto:[^\s@]+@[^\s@]+/i.test(href) || /^tel:\+?\d+$/i.test(href)) return href;
  if (!/^https:\/\//i.test(href)) return '';
  try {
    const url = new URL(href);
    return url.hostname && !url.username && !url.password ? url.href : '';
  } catch {
    return '';
  }
}

function link(value: unknown, fallback = '') {
  const field = object(value);
  if (!field) return safeHref(value) || fallback;
  const raw = text(field.url) || text(field.cached_url);
  if (field.linktype === 'email') return safeHref(`mailto:${text(field.email) || raw}`) || fallback;
  if (field.linktype === 'story') {
    const storyPath = text(object(field.story)?.full_slug) || text(field.cached_url);
    const anchor = text(field.anchor);
    // Only this story is served by the frontend. Other destinations should be explicit URLs.
    if (storyPath.replace(/^\/|\/$/g, '') === HOME_SLUG) {
      return anchor ? (safeHref(`#${anchor}`) || fallback) : '/';
    }
    return fallback;
  }
  return safeHref(raw) || fallback;
}

function asset(value: unknown, fallback: Artwork): Artwork {
  const field = object(value);
  const candidate = text(field?.filename, text(value));
  const url = safeHref(candidate.startsWith('//') ? `https:${candidate}` : candidate);
  return /^(https:\/\/|\/(?!\/))/.test(url)
    ? { src: url, alt: text(field?.alt, fallback.alt) }
    : fallback;
}

function editorialAction(blok: Blok | undefined, field: string, fallback?: Action) {
  const label = text(blok?.[`${field}_label`], fallback?.label);
  const href = link(blok?.[`${field}_link`], fallback?.href);
  if (label && href) return { label, href };
}

function sceneFor(id: SceneId, index: number, rows: Blok[]): Scene {
  const fallback = DEFAULT_SCENES[index];
  const blok = rows.find((row) => row.scene_key === id);
  return {
    ...fallback,
    blok,
    title: text(blok?.title, fallback.title),
    script: text(blok?.script, fallback.script),
    kicker: text(blok?.kicker, fallback.kicker),
    description: text(blok?.description, fallback.description),
    desktop: asset(blok?.desktop_still, art(`${id}-desktop.webp`)),
    mobile: asset(blok?.mobile_still, art(`${id}-mobile.webp`)),
    actions: [
      editorialAction(blok, 'primary', fallback.actions[0]),
      editorialAction(blok, 'secondary', fallback.actions[1]),
    ].filter((item): item is Action => Boolean(item)),
  };
}

function originProducts(blok: Blok | undefined): Product[] {
  const entries = blocks(blok?.products, PRODUCT_BLOCK).filter((item) => text(item.name));
  const defaults = DEFAULT_PRODUCTS.map((item) => ({
    ...item,
    image: art(`pack-${item.id}.webp`, `Paquete de café Cabrales ${item.name}`),
    link: action('Comprar', `${STORE}/productos/cafe-tostado-molido-${item.id}/`),
  }));
  if (!entries.length) return defaults;
  return entries.slice(0, 4).map((entry, index) => {
    const name = text(entry.name);
    const key = text(entry.product_key);
    const fallback = defaults.find((item) => item.id === key);
    return {
      id: key || `producto-${index + 1}`, name, blok: entry,
      note: text(entry.note, fallback?.note),
      image: asset(entry.image, fallback?.image ?? { src: '', alt: `Paquete de café Cabrales ${name}` }),
      link: { label: text(entry.buy_label, 'Comprar'), href: link(entry.buy_link, fallback?.link.href ?? SHOP) },
    };
  });
}

function marksFor(rows: Blok[], field: 'end_desktop' | 'end_mobile') {
  const marks = [0, ...SCENE_IDS.slice(0, 4).map((key, index) => {
    const value = rows.find((row) => row.scene_key === key)?.[field];
    return (typeof value === 'number' || typeof value === 'string' && value.trim()) && Number.isFinite(Number(value))
      ? Number(value) : DEFAULT_MARKS[index + 1];
  })];
  return validMarks(marks) ? marks : [...DEFAULT_MARKS];
}

export function homeContent(raw?: Blok) {
  const blok = raw?.component === HOME_SLUG ? raw : undefined;
  const rows = blocks(blok?.scenes, SCENE_BLOCK);
  const desktopFilm = art('cabrales-scroll-desktop.mp4');
  const mobileFilm = art('cabrales-scroll-mobile.mp4');
  const desktop = asset(blok?.video_desktop, desktopFilm).src;
  const mobile = asset(blok?.video_mobile, mobileFilm).src;
  return {
    logo: asset(blok?.logo, art('cabrales-logo.webp', 'Cabrales')),
    film: {
      desktop,
      mobile,
      // Each intro is cut against its supplied film, not an editorial replacement.
      desktopLoop: desktop === desktopFilm.src ? '/media/cabrales-loop-desktop.mp4' : undefined,
      mobileLoop: mobile === mobileFilm.src ? '/media/cabrales-loop-mobile.mp4' : undefined,
      desktopMarks: marksFor(rows, 'end_desktop'),
      mobileMarks: marksFor(rows, 'end_mobile'),
    },
    hint: text(blok?.scroll_hint, 'Deslizá para descubrir'),
    navigation: [
      action(text(blok?.products_label, 'Productos'), link(blok?.products_link, '#productos')),
      action(text(blok?.about_label, 'Sobre Cabrales'), link(blok?.about_link, HISTORY)),
      action(text(blok?.locations_label, 'Locales'), link(blok?.locations_link, `${SITE}/locales/`)),
      action(text(blok?.store_label, 'Tienda online'), link(blok?.store_link, `${STORE}/`)),
    ],
    scenes: SCENE_IDS.map((id, index) => sceneFor(id, index, rows)),
    products: originProducts(blok),
    meta: {
      title: text(blok?.meta_title, DEFAULT_TITLE),
      description: text(blok?.meta_description, DEFAULT_DESCRIPTION),
      image: asset(blok?.meta_image, art('cabrales-social.jpg')),
    },
    footer: {
      tagline: text(blok?.footer_tagline, 'Somos apasionados. Somos Cabrales.'),
      address: text(blok?.footer_address, 'Rivadavia 3171, Mar del Plata, Buenos Aires'),
      officePhone: { label: text(blok?.office_label, '+54 223 491 6363'), href: link(blok?.office_link, 'tel:+542234916363') },
      supportPhone: { label: text(blok?.support_label, '0810 222 CAFÉ (2233)'), href: link(blok?.support_link, 'tel:08102222233') },
      email: { label: text(blok?.email_label, EMAIL), href: link(blok?.email_link, `mailto:${EMAIL}`) },
      socials: [
        action('Instagram', link(blok?.instagram_link, 'https://www.instagram.com/cafe.cabrales/')),
        action('Facebook', link(blok?.facebook_link, 'https://www.facebook.com/cafe.cabrales/')),
        action('X', link(blok?.x_link, 'https://twitter.com/arribacabrales')),
      ],
      legal: [
        editorialAction(blok, 'privacy', { label: 'Privacidad', href: '' }),
        editorialAction(blok, 'terms', { label: 'Términos y condiciones', href: '' }),
      ].filter((item): item is Action => Boolean(item)),
    },
  };
}

export type HomeContent = ReturnType<typeof homeContent>;
