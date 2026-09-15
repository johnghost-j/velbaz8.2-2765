/**
 * Import dynamique VOLONTAIREMENT opaque pour les bundlers.
 *
 * [2026-09-11] La publication échouait (`bundle-server failed`) parce que le
 * bundler suivait les imports dynamiques de `playwright-core` et `ccxt` et
 * tentait de les inliner : il butait alors sur leurs dépendances optionnelles
 * absentes (`protobufjs/minimal.js`, `chromium-bidi/...`).
 *
 * Ces modules sont lourds, natifs, et utilisés uniquement dans des chemins
 * facultatifs (navigateur headless, trading live). En passant le nom du module
 * par une variable, le bundler ne peut plus le résoudre statiquement : il laisse
 * l'import au runtime, où le paquet est bien présent dans node_modules.
 */
export async function importOptional<T = any>(moduleName: string): Promise<T> {
  const specifier = moduleName;
  return (await import(/* @vite-ignore */ /* webpackIgnore: true */ specifier)) as T;
}

/**
 * `sharp` est une bibliothèque NATIVE (libvips). Inlinée dans le bundle serveur,
 * elle plante au démarrage (`TypeError: undefined is not an object (evaluating
 * 'format.jp2k.output')`) et la machine ne passe plus le health check.
 * On la charge donc au runtime, une seule fois, via ce cache.
 */
let sharpMod: any;
export async function getSharp(): Promise<any> {
  if (!sharpMod) {
    const m = await importOptional<any>('sharp');
    sharpMod = m?.default ?? m;
  }
  return sharpMod;
}
