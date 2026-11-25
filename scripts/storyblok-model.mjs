import { randomUUID } from 'node:crypto';
import { HOME_SLUG, PRODUCT_BLOCK, SCENE_BLOCK, homeContent } from '../src/lib/content.ts';
import { DEFAULT_MARKS, SCENE_IDS } from '../src/lib/timeline.ts';

const field = (type, display_name, properties = {}) => ({ type, display_name, ...properties });
const text = (label, properties) => field('text', label, properties);
const long = (label) => field('textarea', label);
const link = (label) => field('multilink', label);
const image = (label) => field('asset', label, { filetypes: ['images'], allow_external_url: true });
const video = (label) => field('asset', label, { filetypes: ['videos'], allow_external_url: true });
const seconds = (label) => field('number', label, { min_value: 0, description: 'Segundo en el que termina este tramo del montaje, no un porcentaje de scroll. El cierre congela el video.' });
const nested = (label, name, maximum) => field('bloks', label, { maximum, restrict_components: true, component_whitelist: [name], restrict_type: '' });
const option = (name, choices) => field('option', name, {
  required: true,
  options: choices.map(([value, label], index) => ({ value, name: label, _uid: `39eb63f4-58c0-4bd2-8dd7-${String(index + 1).padStart(12, '0')}` })),
});
const action = (key, label) => ({ [`${key}_label`]: text(label), [`${key}_link`]: link(`Destino · ${label}`) });

function component(name, display_name, fields, root = false, preview_field = null) {
  return {
    name, display_name, is_root: root, is_nestable: !root, preview_field,
    schema: Object.fromEntries(Object.entries(fields).map(([key, def], pos) => [key, { ...def, pos }])),
  };
}

export const components = [
  component(PRODUCT_BLOCK, 'Cabrales · Café de origen', {
    product_key: text('Clave de imagen local', { description: 'Opcional. Usá brasil, colombia, peru o prestige para mantener el packshot provisto.' }),
    name: text('Nombre', { required: true }),
    note: long('Nota de cata'),
    image: image('Foto del paquete'),
    ...action('buy', 'Comprar'),
  }, false, 'name'),
  component(SCENE_BLOCK, 'Cabrales · Escena', {
    scene_key: option('Escena del recorrido', [['cafe', 'Café Cabrales'], ['molido', 'Molido'], ['super', 'Súper Cabrales'], ['origenes', 'La familia'], ['reunion', 'Reunión']]),
    script: text('Texto caligráfico'),
    title: text('Titular', { required: true }),
    kicker: text('Línea en mayúsculas'),
    description: long('Descripción'),
    ...action('primary', 'Acción principal'),
    ...action('secondary', 'Acción secundaria'),
    desktop_still: image('Imagen fija · escritorio'),
    mobile_still: image('Imagen fija · móvil'),
    end_desktop: seconds('Fin del tramo · escritorio'),
    end_mobile: seconds('Fin del tramo · móvil'),
  }, false, 'title'),
  component(HOME_SLUG, 'Cabrales · Home V2', {
    logo: image('Marca Cabrales'),
    video_desktop: video('Video de scroll · escritorio 16:9'),
    video_mobile: video('Video de scroll · móvil 9:16'),
    scroll_hint: text('Indicador de scroll'),
    scenes: nested('Escenas del recorrido', SCENE_BLOCK, 5),
    products: nested('Cafés de origen', PRODUCT_BLOCK, 4),
    ...action('products', 'Productos'),
    ...action('about', 'Sobre Cabrales'),
    ...action('locations', 'Locales'),
    ...action('store', 'Tienda online'),
    footer_tagline: text('Frase del footer'),
    footer_address: long('Dirección de Casa Central'),
    ...action('office', 'Teléfono de Casa Central'),
    ...action('support', 'Teléfono de atención'),
    ...action('email', 'Correo de atención'),
    instagram_link: link('Instagram'), facebook_link: link('Facebook'), x_link: link('X'),
    ...action('privacy', 'Privacidad'), ...action('terms', 'Términos y condiciones'),
    meta_title: text('Título para buscadores'),
    meta_description: long('Descripción para buscadores'),
    meta_image: image('Imagen para redes sociales'),
  }, true),
];

function url(value) {
  return { fieldtype: 'multilink', id: '', linktype: 'url', url: value ?? '', cached_url: value ?? '' };
}

export function seedContent() {
  const home = homeContent();
  return {
    component: HOME_SLUG, _uid: randomUUID(), scroll_hint: home.hint,
    scenes: home.scenes.map((scene, i) => ({
      component: SCENE_BLOCK, _uid: randomUUID(), scene_key: SCENE_IDS[i],
      script: scene.script, title: scene.title, kicker: scene.kicker, description: scene.description,
      primary_label: scene.actions[0]?.label ?? '', primary_link: url(scene.actions[0]?.href),
      secondary_label: scene.actions[1]?.label ?? '', secondary_link: url(scene.actions[1]?.href),
      ...(i < 4 ? { end_desktop: DEFAULT_MARKS[i + 1], end_mobile: DEFAULT_MARKS[i + 1] } : {}),
    })),
    products: home.products.map(({ id, name, note, link: action }) => ({
      component: PRODUCT_BLOCK, _uid: randomUUID(), product_key: id,
      name, note, buy_label: action.label, buy_link: url(action.href),
    })),
    ...Object.fromEntries(['products', 'about', 'locations', 'store'].flatMap((key, index) => {
      const item = home.navigation[index];
      return [[`${key}_label`, item.label], [`${key}_link`, url(item.href)]];
    })),
    footer_tagline: home.footer.tagline, footer_address: home.footer.address,
    office_label: home.footer.officePhone.label, office_link: url(home.footer.officePhone.href),
    support_label: home.footer.supportPhone.label, support_link: url(home.footer.supportPhone.href),
    email_label: home.footer.email.label, email_link: url(home.footer.email.href),
    instagram_link: url(home.footer.socials[0].href), facebook_link: url(home.footer.socials[1].href), x_link: url(home.footer.socials[2].href),
    meta_title: home.meta.title, meta_description: home.meta.description,
  };
}

export function isEmptyDefaultDraft(story) {
  return story?.full_slug === HOME_SLUG && story.slug === HOME_SLUG && !story.is_folder &&
    story.published === false && !story.published_at && !story.first_published_at &&
    story.content?.component === 'default-page' &&
    Object.entries(story.content).every(([key, value]) => key === 'component' || key.startsWith('_') ||
      value == null || value === '' || Array.isArray(value) && value.length === 0);
}
