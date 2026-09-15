// ═══════════════════════════════════════════════════════════════════════════
// LOOKBOOK — banque de références visuelles du skill /genesis (chimera)
//
// 298 captures réelles de sites et d'apps choisies par le propriétaire du skill
// (chimera-refs-30 : 11→40, chimera-refs-70 : 41→110, chimera-refs-200 : 111→310).
// Chaque entrée dit CE QU'IL FAUT VOLER à l'image, dans les mots des références
// du skill (`references/storefront.md`). On n'envoie pas les pixels au modèle
// d'image : on lui envoie la description du layout à viser, tirée de cette banque.
//
// Généré depuis les refs.md des trois lots. Ne pas éditer à la main.
// ═══════════════════════════════════════════════════════════════════════════

export type LookbookEntry = {
  /** numéro du fichier de référence, ex. 137 → `137.png` */
  n: number;
  /** lot d'origine */
  lot: "lot1" | "lot2" | "lot3";
  /** section thématique du refs.md */
  section: string;
  /** ce qu'il faut voler à cette image */
  desc: string;
};

export const LOOKBOOK: LookbookEntry[] = [
  { n: 11, lot: "lot1", section: "Dégradés clairs / mesh (prolonge 01, 02)", desc: "Warm yellow→cream mesh wash, flush white bar, huge two-line display headline, one big rounded product panel with a violet pill CTA inside it." },
  { n: 12, lot: "lot1", section: "Dégradés clairs / mesh (prolonge 01, 02)", desc: "Near-white page, one pale prism gradient object as the only imagery, centred 15-word headline, two small pills (one dark filled, one ghost). Restraint as a style." },
  { n: 13, lot: "lot1", section: "Dégradés clairs / mesh (prolonge 01, 02)", desc: "Pale blue→pink wash, headline with one word in a second weight, a thin line-drawn illustration bleeding off the right edge, logo strip cropped at the bottom." },
  { n: 14, lot: "lot1", section: "Dégradés clairs / mesh (prolonge 01, 02)", desc: "Diagonal magenta→orange gradient sheets on white, headline left-aligned in a narrow column, product UI cards floating over the gradient at an angle." },
  { n: 15, lot: "lot1", section: "Dégradés clairs / mesh (prolonge 01, 02)", desc: "Orange→pink field with a *dark* rounded app panel floating in the middle, monospace payload inside it. Proof that dark UI on a hot gradient reads as 2026 software." },
  { n: 16, lot: "lot1", section: "Dégradés clairs / mesh (prolonge 01, 02)", desc: "Full-bleed magenta/violet gradient, one pale rounded input card centred with a single field and one dark action button bottom-right. The purest \"one object on colour\" hero." },
  { n: 17, lot: "lot1", section: "Dégradés clairs / mesh (prolonge 01, 02)", desc: "Blue→pink dusk gradient with a tiny illustrated horizon, centred serif-ish headline, and a large browser-UI card half cropped by the bottom frame edge." },
  { n: 18, lot: "lot1", section: "Dégradés clairs / mesh (prolonge 01, 02)", desc: "White top half / violet gradient bottom half, headline + two pills above, one wide dashboard card straddling the colour break." },
  { n: 19, lot: "lot1", section: "Dégradés clairs / mesh (prolonge 01, 02)", desc: "Deep teal→blue underwater gradient, wide-tracked thin display type, one small scroll pill. Dark-but-colourful register, no black." },
  { n: 20, lot: "lot1", section: "Dégradés clairs / mesh (prolonge 01, 02)", desc: "Near-black canvas with one wide glowing red/orange arc rising from the bottom, small centred headline, one lime pill CTA." },
  { n: 21, lot: "lot1", section: "Sombre + un seul glow (prolonge 05, 06, 07)", desc: "Near-black with a soft red bloom top-left, dark command panel with a real list of rows, small monospace metadata bottom right." },
  { n: 22, lot: "lot1", section: "Sombre + un seul glow (prolonge 05, 06, 07)", desc: "Black page, one silky blue light-ribbon as the only imagery, then two half-cropped feature cards with their own mini gradients." },
  { n: 23, lot: "lot1", section: "Sombre + un seul glow (prolonge 05, 06, 07)", desc: "Dark violet glow behind the headline, small 3D toy objects scattered in the mid-band, a dark app screenshot cropped by the bottom edge, two pill CTAs (one green)." },
  { n: 24, lot: "lot1", section: "Sombre + un seul glow (prolonge 05, 06, 07)", desc: "Dark page, tight headline, and a horizontal scrolling strip of small bright site thumbnails — colour comes from the content, not the background." },
  { n: 25, lot: "lot1", section: "Apps denses (prolonge 10)", desc: "Light dense CRM/mail app: left rail, list column, right detail panel, open context menu, coloured chips. Real controls, real density." },
  { n: 26, lot: "lot1", section: "Apps denses (prolonge 10)", desc: "Dark issue tracker: sidebar, grouped rows with status icons, priority chips, a floating filter bar at the top of the list." },
  { n: 28, lot: "lot1", section: "Calme, minimal, éditeur (prolonge 07, 09)", desc: "Almost empty near-white page: wordmark top left, one thin concentric-circle diagram centred, two words of display type bottom left." },
  { n: 29, lot: "lot1", section: "Calme, minimal, éditeur (prolonge 07, 09)", desc: "Editor UI: dark chrome, left layer tree, right inspector, and in the canvas a light page with a huge serif wordmark. Chrome dark, content bright." },
  { n: 30, lot: "lot1", section: "Calme, minimal, éditeur (prolonge 07, 09)", desc: "White page with dozens of small rounded image cards floating in depth around a short centred headline and one dark pill." },
  { n: 31, lot: "lot1", section: "Champ de couleur / typo géante (prolonge 03, 04)", desc: "Cream field, tiny nav, one enormous black lowercase wordmark, a single photo card sitting inside the letters' space." },
  { n: 32, lot: "lot1", section: "Champ de couleur / typo géante (prolonge 03, 04)", desc: "Photo band with a giant white wordmark overlapping the subject, product cut out and floating over it, everything else removed." },
  { n: 33, lot: "lot1", section: "Champ de couleur / typo géante (prolonge 03, 04)", desc: "Loud magenta page, white bold headline left, photo tiles at different rotations right, one white pill CTA, thin banner strip at the very bottom." },
  { n: 34, lot: "lot1", section: "Illustration grainée (prolonge 08)", desc: "Flat cobalt/orange grainy illustration in a rounded frame, characters inside a room drawn in 3 colours, tiny slide counter and wordmark in the corners." },
  { n: 35, lot: "lot1", section: "Produit découpé sur couleur (le registre qui manquait)", desc: "Dark bottles standing in a magenta→violet glow, hard rim light, deep contact shadow. Product first, no set, no story." },
  { n: 36, lot: "lot1", section: "Produit découpé sur couleur (le registre qui manquait)", desc: "Three sneakers cut out on a pink→lilac gradient, evenly lit, floating at slightly different heights with soft shadows." },
  { n: 37, lot: "lot1", section: "Produit découpé sur couleur (le registre qui manquait)", desc: "Saturated green field, one product held in frame, small dark UI cards over the colour. Brand colour used as the whole background." },
  { n: 38, lot: "lot1", section: "Produit découpé sur couleur (le registre qui manquait)", desc: "Dark shop page: hero product close-up left, 3-up product grid right on white cards, prices always visible." },
  { n: 39, lot: "lot1", section: "Photo produit calme (prolonge 09)", desc: "Three pale-wall product photographs side by side, even soft light, no props, generous air above each object." },
  { n: 40, lot: "lot1", section: "Photo produit calme (prolonge 09)", desc: "Real product page skeleton: gallery thumbnails, title, spec chips, price, one blue buy pill, feature blocks below. Copy the *structure*, not the style." },
  { n: 41, lot: "lot2", section: "Dégradés clairs / mesh + carte centrale (41-52)", desc: "Full-bleed pink → violet mesh wash, one centred sentence-headline, thin floating nav, a single small dark pill CTA. Nothing else on the surface." },
  { n: 42, lot: "lot2", section: "Dégradés clairs / mesh + carte centrale (41-52)", desc: "Pale lilac → white gradient hero over a white app card that overlaps the fold: the gradient carries the emotion, the card carries the proof." },
  { n: 44, lot: "lot2", section: "Dégradés clairs / mesh + carte centrale (41-52)", desc: "Orange → violet → blue gradient field with only a wordmark on it. The reference for \"one object on a gradient is enough\"." },
  { n: 45, lot: "lot2", section: "Dégradés clairs / mesh + carte centrale (41-52)", desc: "Pure blue → pink colour field with a tiny row of icons floating at the bottom edge — a dock reduced to a graphic accent." },
  { n: 46, lot: "lot2", section: "Dégradés clairs / mesh + carte centrale (41-52)", desc: "Hot pink / magenta grainy texture field, no UI at all. Use as a background plate when the page needs a loud colour with visible grain." },
  { n: 47, lot: "lot2", section: "Dégradés clairs / mesh + carte centrale (41-52)", desc: "Warm yellow → cream gradient, centred headline, then a large rounded app card sitting half over the gradient with a real table inside." },
  { n: 48, lot: "lot2", section: "Dégradés clairs / mesh + carte centrale (41-52)", desc: "Orange gradient page framing a light product/app screenshot in a rounded card with a photographic subject inside the card, not behind it." },
  { n: 49, lot: "lot2", section: "Dégradés clairs / mesh + carte centrale (41-52)", desc: "Violet gradient event page: big friendly headline, one lime pill CTA, small photo cards drifting at the edges." },
  { n: 50, lot: "lot2", section: "Dégradés clairs / mesh + carte centrale (41-52)", desc: "Deep purple field, white headline with one word coloured, illustrated 3D object cut out on the colour, logo strip under the fold." },
  { n: 51, lot: "lot2", section: "Dégradés clairs / mesh + carte centrale (41-52)", desc: "Flat purple field with a row of phone screens standing on it, soft contact shadows, wordmark bottom-centre. Product-as-UI on colour." },
  { n: 52, lot: "lot2", section: "Dégradés clairs / mesh + carte centrale (41-52)", desc: "Pale sky-blue → white wash, floating white pill nav, centred headline, a row of small round avatars above it, one blue pill CTA." },
  { n: 53, lot: "lot2", section: "Champ de couleur pur + typo géante (53-62)", desc: "Pure red field with a *huge* black display word across the full width, small nav floating above it, thin product row below. Maximum contrast, zero decoration." },
  { n: 54, lot: "lot2", section: "Champ de couleur pur + typo géante (53-62)", desc: "Flat cobalt field, two names separated by a giant \"VS\" in italic serif. Type as the only image." },
  { n: 55, lot: "lot2", section: "Champ de couleur pur + typo géante (53-62)", desc: "Blue page with a stretched/condensed distorted logotype, thin rules and a tiny CTA pill. Typographic hero with no photography." },
  { n: 56, lot: "lot2", section: "Champ de couleur pur + typo géante (53-62)", desc: "Red-on-white cart page: \"YOUR BAG\" set enormous, product line-items in plain type, \"Checkout ↗\" as the only accent. Even a utility page is a poster." },
  { n: 57, lot: "lot2", section: "Champ de couleur pur + typo géante (53-62)", desc: "Cream page, huge centred serif display type in four lines, one small label above. Editorial calm at large scale." },
  { n: 58, lot: "lot2", section: "Champ de couleur pur + typo géante (53-62)", desc: "Black/white editorial: an enormous name across the base of the page, one small image card floating in the white space above it." },
  { n: 59, lot: "lot2", section: "Champ de couleur pur + typo géante (53-62)", desc: "Cream type-specimen layout: giant family name bottom-left, small spec grid and weight sliders top. Use for a \"manifesto\" section." },
  { n: 60, lot: "lot2", section: "Champ de couleur pur + typo géante (53-62)", desc: "Grid where each cell alternates a letter of the wordmark and a cropped photo — big type and photography interlocked instead of layered." },
  { n: 61, lot: "lot2", section: "Champ de couleur pur + typo géante (53-62)", desc: "White page, oversized lowercase wordmark, one photograph inside a rounded card above it, tiny + control top right." },
  { n: 62, lot: "lot2", section: "Champ de couleur pur + typo géante (53-62)", desc: "Violet-on-black giant numerals bleeding off the edges. Numbers as the visual, for a stats or \"results\" section." },
  { n: 63, lot: "lot2", section: "Sombre + un seul glow (63-73)", desc: "Near-black page, centred headline, one wide dark rounded input as the only object, faint bottom horizon glow." },
  { n: 64, lot: "lot2", section: "Sombre + un seul glow (63-73)", desc: "Dark canvas with a centred question-headline and a dark search field, thin left rail of small controls. The dark twin of the gradient hero." },
  { n: 65, lot: "lot2", section: "Sombre + un seul glow (63-73)", desc: "Dark blue page, headline with one word in electric accent, a classical sculpture cut out on the right, small pill nav." },
  { n: 66, lot: "lot2", section: "Sombre + un seul glow (63-73)", desc: "Near-black + hot orange: a huge number as the headline, image cards scattered at low opacity, one filled orange CTA." },
  { n: 67, lot: "lot2", section: "Sombre + un seul glow (63-73)", desc: "Dark product page, two-line white headline, one soft warm glow rising bottom-left, small logo row. Restraint is the point." },
  { n: 68, lot: "lot2", section: "Sombre + un seul glow (63-73)", desc: "Dark full-width strip of cropped portrait frames under a thin serif wordmark. Photography as a band inside a dark page." },
  { n: 69, lot: "lot2", section: "Sombre + un seul glow (63-73)", desc: "Near-black with a deep blue metallic sheen sweeping across it, centred small headline, one pill CTA. Texture without imagery." },
  { n: 70, lot: "lot2", section: "Sombre + un seul glow (63-73)", desc: "Very dark minimal page: white headline top-left, one dark card with a list inside it, one accent chip. Almost nothing, still finished." },
  { n: 71, lot: "lot2", section: "Sombre + un seul glow (63-73)", desc: "Dark grid page, two logos on either side of a small \"VS\", thin cross-hatch background. Comparison layout, dark register." },
  { n: 72, lot: "lot2", section: "Sombre + un seul glow (63-73)", desc: "Dark grey card floating on a hatched grey field, small link list inside, one red pill CTA. Use for a contact/CTA block." },
  { n: 73, lot: "lot2", section: "Sombre + un seul glow (63-73)", desc: "Black stage with one 3D object glowing centre, wordmark set small above it, dune horizon line. One object, one light." },
  { n: 74, lot: "lot2", section: "Apps denses et éditeurs (74-85)", desc: "Light CRM: left nav, dense table, coloured status pills, an open contextual menu. Real controls at real density." },
  { n: 75, lot: "lot2", section: "Apps denses et éditeurs (74-85)", desc: "Light workspace app inside a marketing page: sidebar, thread list, message column, avatars. Product shown, not described." },
  { n: 76, lot: "lot2", section: "Apps denses et éditeurs (74-85)", desc: "Dark tracking UI: tab bar, detail panel with labelled fields, a subdued blue primary button." },
  { n: 77, lot: "lot2", section: "Apps denses et éditeurs (74-85)", desc: "Dark analytics: two dense sortable tables side by side, numeric columns, thin dividers, no chrome decoration." },
  { n: 78, lot: "lot2", section: "Apps denses et éditeurs (74-85)", desc: "Violet-sidebar mail app: coloured folder icons, thread body, inline action buttons. Colour only in the rail." },
  { n: 79, lot: "lot2", section: "Apps denses et éditeurs (74-85)", desc: "Dark assistant app: centred prompt field, suggestion cards under it, thin left history rail." },
  { n: 80, lot: "lot2", section: "Apps denses et éditeurs (74-85)", desc: "Dark code editor: syntax colours as the palette, file tree, tabs, terminal split. Use for a \"how it works\" panel." },
  { n: 81, lot: "lot2", section: "Apps denses et éditeurs (74-85)", desc: "Dark media app: two video frames side by side, right-hand metadata column, small toolbar." },
  { n: 82, lot: "lot2", section: "Apps denses et éditeurs (74-85)", desc: "Dark timeline editor: track lanes, subtitle rows, sliders and a round accent action button." },
  { n: 83, lot: "lot2", section: "Apps denses et éditeurs (74-85)", desc: "Dark issue tracker: label chips, grouped list, keyboard-style controls. Flat, fast, no gradients." },
  { n: 84, lot: "lot2", section: "Apps denses et éditeurs (74-85)", desc: "Dark audience table with a green metric column and a top filter bar. Data as the hero image." },
  { n: 85, lot: "lot2", section: "Apps denses et éditeurs (74-85)", desc: "Editor + terminal split on near-black, one acid accent in the status bar." },
  { n: 86, lot: "lot2", section: "Clair, calme, minimal (86-94)", desc: "Off-white editorial page: small serif label, thin outlined circle as the only graphic, two narrow text columns, two dark pill buttons." },
  { n: 87, lot: "lot2", section: "Clair, calme, minimal (86-94)", desc: "Pure white page, thin concentric circle diagram centred, wordmark top-left, giant caption at the base. Silence used deliberately." },
  { n: 88, lot: "lot2", section: "Clair, calme, minimal (86-94)", desc: "Light SaaS page: one clear price promise as the headline, two pills, then a strip of small work cards bleeding off the bottom." },
  { n: 89, lot: "lot2", section: "Clair, calme, minimal (86-94)", desc: "White hero with a headline left, a stack of overlapping rounded photo/app cards right, one dark CTA." },
  { n: 90, lot: "lot2", section: "Clair, calme, minimal (86-94)", desc: "Light onboarding: one question, one input, one button, dim illustration to the right. The whole page is one decision." },
  { n: 91, lot: "lot2", section: "Clair, calme, minimal (86-94)", desc: "Clean beauty commerce: pale sections, product cut-outs on cream, small serif headings, generous air between blocks." },
  { n: 92, lot: "lot2", section: "Clair, calme, minimal (86-94)", desc: "Editorial shop page: warm white field, one plant/object photographed calmly, right-hand list of tiny product rows." },
  { n: 93, lot: "lot2", section: "Clair, calme, minimal (86-94)", desc: "Light product grid: uniform cut-outs on white with a thin rule between rows, small caption type, wordmark centred at the top." },
  { n: 94, lot: "lot2", section: "Clair, calme, minimal (86-94)", desc: "Grey studio photography: furniture and vessels on a seamless pale wall, soft shadow, nothing else. The calm end of the range." },
  { n: 95, lot: "lot2", section: "Illustration grainée / 3D (95-98)", desc: "Flat drawn characters and objects in bold complementary colours on cream, hand-lettered headline, heavy grain. Use when the world should feel drawn." },
  { n: 96, lot: "lot2", section: "Illustration grainée / 3D (95-98)", desc: "Pastel 3D scene: rounded plastic-looking blocks and a small mascot on lilac, soft studio light. Toy-like, still premium." },
  { n: 97, lot: "lot2", section: "Illustration grainée / 3D (95-98)", desc: "Dark grainy illustration band: neon green figure on violet, glow doodles, serif copy over it. Grain plus a single acid colour." },
  { n: 98, lot: "lot2", section: "Illustration grainée / 3D (95-98)", desc: "Orange grainy illustration of an interior with characters, arch-shaped frame, small caption in the corner. Poster, not photo." },
  { n: 99, lot: "lot2", section: "Produit découpé sur couleur (99-106)", desc: "Three sneakers cut out and standing on a violet → pink gradient, hard focus, soft contact shadows, tiny nav. Exactly rule zero." },
  { n: 100, lot: "lot2", section: "Produit découpé sur couleur (99-106)", desc: "Soda cans lined up on an orange gradient card, hand-lettered headline left. Product, colour, nothing else." },
  { n: 101, lot: "lot2", section: "Produit découpé sur couleur (99-106)", desc: "Two red-and-white sneakers on plain white, evenly lit, correctly proportioned, centred with air around them. Reference for \"shot professionally\"." },
  { n: 102, lot: "lot2", section: "Produit découpé sur couleur (99-106)", desc: "Translucent cosmetic jar glowing on a pink → orange gradient field, no props, no text. One object, one colour." },
  { n: 103, lot: "lot2", section: "Produit découpé sur couleur (99-106)", desc: "Dark commerce card: product/portrait photo left, price, size chips and \"Add to Bag\" right, all inside one rounded card." },
  { n: 104, lot: "lot2", section: "Produit découpé sur couleur (99-106)", desc: "Row of foundation bottles on warm beige, soft daylight, brand mark small. Calm product photography inside a designed page." },
  { n: 105, lot: "lot2", section: "Produit découpé sur couleur (99-106)", desc: "Pale blue/pink page with sneakers cut out across it and a small yellow price card. Colour blocking plus cut-outs." },
  { n: 106, lot: "lot2", section: "Produit découpé sur couleur (99-106)", desc: "Coral field, two figures photographed and cut out, headline set over them so the type and the subject overlap." },
  { n: 107, lot: "lot2", section: "Photo + typo géante (107-110)", desc: "Enormous white wordmark laid across a cropped photograph, letters running off both edges. One photo, one word." },
  { n: 108, lot: "lot2", section: "Photo + typo géante (107-110)", desc: "Aerial photograph with a giant sentence sitting on the bottom edge, small pill nav floating clear of the top." },
  { n: 109, lot: "lot2", section: "Photo + typo géante (107-110)", desc: "Dark athletic page: high-contrast photo left, \"BUILT TO BREAK LIMITS\" right, a small grid of stat tiles and one acid CTA." },
  { n: 110, lot: "lot2", section: "Photo + typo géante (107-110)", desc: "Dark page with red draped fabric photographed as texture, serif headline centred over it, one thin CTA. Photography used as a colour field." },
  { n: 111, lot: "lot3", section: "Apps claires et denses + wordmark géant (111-125)", desc: "Light CRM workspace: thin left rail, dense list of rows, an open dropdown menu with real labels. Use for an account or order page, never a hero." },
  { n: 112, lot: "lot3", section: "Apps claires et denses + wordmark géant (111-125)", desc: "White page, one enormous black wordmark across the full width, a tiny image card floating above it. Type is the whole design." },
  { n: 113, lot: "lot3", section: "Apps claires et denses + wordmark géant (111-125)", desc: "Pale layout study: light wireframe cards on the left, a dark app panel on the right. Shows light and dark surfaces coexisting on one page." },
  { n: 114, lot: "lot3", section: "Apps claires et denses + wordmark géant (111-125)", desc: "Cream page holding a dark product card: model photo, product name, price, \"Add to Bag\" pill. The card is the shop, the page is the mood." },
  { n: 115, lot: "lot3", section: "Apps claires et denses + wordmark géant (111-125)", desc: "Pastel doodle-collage register: hand-drawn objects and characters scattered on white, one two-tone headline. Illustrated, premium, no mascot." },
  { n: 116, lot: "lot3", section: "Apps claires et denses + wordmark géant (111-125)", desc: "Grey studio frame around a browser mockup with a photographic hero inside. Use when the site itself must be the subject." },
  { n: 117, lot: "lot3", section: "Apps claires et denses + wordmark géant (111-125)", desc: "Soft green-tinted site with an editorial \"Blog\" title, plus a phone mockup standing on the colour." },
  { n: 118, lot: "lot3", section: "Apps claires et denses + wordmark géant (111-125)", desc: "Service landing template: red/blue accents, centred headline, big van photo, thick sans. The loud commercial end of the range." },
  { n: 119, lot: "lot3", section: "Apps claires et denses + wordmark géant (111-125)", desc: "Violet studio field with three running shoes floating in a row, hard shadows. Product-on-colour without a table." },
  { n: 120, lot: "lot3", section: "Apps claires et denses + wordmark géant (111-125)", desc: "Parchment editorial page: long serif text column beside a thin diagram card. Use for a manifesto or care-instructions page." },
  { n: 121, lot: "lot3", section: "Apps claires et denses + wordmark géant (111-125)", desc: "White hero sentence, then a lilac gradient app card overlapping the fold with a real chart inside it." },
  { n: 122, lot: "lot3", section: "Apps claires et denses + wordmark géant (111-125)", desc: "Near-black page, one centred sentence-headline, nothing else. The most reduced dark hero in the set." },
  { n: 123, lot: "lot3", section: "Apps claires et denses + wordmark géant (111-125)", desc: "Beige tabletop photo, a row of cosmetics standing side by side, soft even light. Clean product photography for a plate." },
  { n: 124, lot: "lot3", section: "Apps claires et denses + wordmark géant (111-125)", desc: "Dark hero \"Build Your Software Factory\" over a dashboard screenshot with glowing charts." },
  { n: 125, lot: "lot3", section: "Apps claires et denses + wordmark géant (111-125)", desc: "Giant lowercase logotype bleeding off the right edge over a cropped product/hand photo. Wordmark as image." },
  { n: 126, lot: "lot3", section: "Sombre + un accent chaud, panneaux d'app (126-140)", desc: "Dark hero built around one huge number, orange corner glow, small floating avatars. Numbers as the visual." },
  { n: 127, lot: "lot3", section: "Sombre + un accent chaud, panneaux d'app (126-140)", desc: "Cream page, soft lifestyle photos inside rounded cards, generous white space. The calm retail register." },
  { n: 128, lot: "lot3", section: "Sombre + un accent chaud, panneaux d'app (126-140)", desc: "White page, single brand mark plus wordmark, light UI cards under the fold. Restraint as the design." },
  { n: 129, lot: "lot3", section: "Sombre + un accent chaud, panneaux d'app (126-140)", desc: "Light project-hub app: tables, tabs, warm orange accents on white. Dense but friendly." },
  { n: 130, lot: "lot3", section: "Sombre + un accent chaud, panneaux d'app (126-140)", desc: "Dark headline over a horizontal row of site-screenshot cards. Use for a gallery or \"made with\" section." },
  { n: 131, lot: "lot3", section: "Sombre + un accent chaud, panneaux d'app (126-140)", desc: "Light dense workspace UI next to a document page. Two levels of density on the same surface." },
  { n: 132, lot: "lot3", section: "Sombre + un accent chaud, panneaux d'app (126-140)", desc: "Warm dark interior photograph full-bleed with a thin light nav on top. Luxury furniture register." },
  { n: 133, lot: "lot3", section: "Sombre + un accent chaud, panneaux d'app (126-140)", desc: "Dark code editor split with a file tree. Keep for a technical page, never a hero." },
  { n: 134, lot: "lot3", section: "Sombre + un accent chaud, panneaux d'app (126-140)", desc: "Warm orange/cream marketing pair: cards, quotes, soft shadows. The \"trust\" section done in colour." },
  { n: 135, lot: "lot3", section: "Sombre + un accent chaud, panneaux d'app (126-140)", desc: "Magenta/violet nightlife photo hero, white headline, one lime pill CTA, invite cards floating." },
  { n: 136, lot: "lot3", section: "Sombre + un accent chaud, panneaux d'app (126-140)", desc: "Near-black analytics panel, one thin yellow line on a wide grid. Data as decoration." },
  { n: 137, lot: "lot3", section: "Sombre + un accent chaud, panneaux d'app (126-140)", desc: "Black athletic page: cropped runner photo, condensed all-caps headline, lime accent, hard stats block." },
  { n: 138, lot: "lot3", section: "Sombre + un accent chaud, panneaux d'app (126-140)", desc: "Dark page, one long sentence-headline, a red glow behind a cropped machine photo." },
  { n: 139, lot: "lot3", section: "Sombre + un accent chaud, panneaux d'app (126-140)", desc: "White documentation page: small logo, label, headline, two paragraphs. The plainest useful layout here." },
  { n: 140, lot: "lot3", section: "Sombre + un accent chaud, panneaux d'app (126-140)", desc: "Grainy risograph field in pink and orange, no UI. Pure background plate with visible grain." },
  { n: 141, lot: "lot3", section: "Boutiques claires, éditorial et couleur plate (141-155)", desc: "White hero with a row of small avatars above the headline, then a light app card. Social proof placed before the product." },
  { n: 142, lot: "lot3", section: "Boutiques claires, éditorial et couleur plate (141-155)", desc: "Founder photograph at a desk, natural light. Use inside an \"about\" card, never as a full-bleed hero." },
  { n: 143, lot: "lot3", section: "Boutiques claires, éditorial et couleur plate (141-155)", desc: "Dark page with three phone screens carrying bright colour cards. Product-as-UI on black." },
  { n: 144, lot: "lot3", section: "Boutiques claires, éditorial et couleur plate (141-155)", desc: "Dark settings form with real fields and one primary button. The dense end of the dark register." },
  { n: 145, lot: "lot3", section: "Boutiques claires, éditorial et couleur plate (141-155)", desc: "White ceramics shop: big serif product title, single photo, a narrow side column of notes." },
  { n: 146, lot: "lot3", section: "Boutiques claires, éditorial et couleur plate (141-155)", desc: "Nordic shop grid: pale tiles, small captions, plenty of air between products." },
  { n: 147, lot: "lot3", section: "Boutiques claires, éditorial et couleur plate (141-155)", desc: "Dark dense table app, rows of cards, muted accents. Dashboard page only." },
  { n: 148, lot: "lot3", section: "Boutiques claires, éditorial et couleur plate (141-155)", desc: "Cream beauty page in panels: portrait, ingredient cards, review grid — one page telling the whole story." },
  { n: 149, lot: "lot3", section: "Boutiques claires, éditorial et couleur plate (141-155)", desc: "Cobalt field with a stretched, distorted black display logotype and a yellow band with a buy pill." },
  { n: 150, lot: "lot3", section: "Boutiques claires, éditorial et couleur plate (141-155)", desc: "Pale blurred pink/blue wash behind a sneaker shop card. Blur as the background, sharpness reserved for the product." },
  { n: 151, lot: "lot3", section: "Boutiques claires, éditorial et couleur plate (141-155)", desc: "Grid alternating letters of the wordmark with cropped photos, nav row along the bottom. Type and photography interlocked." },
  { n: 152, lot: "lot3", section: "Boutiques claires, éditorial et couleur plate (141-155)", desc: "White design-system page: charts, tokens, a QR block. Use for a spec or documentation page." },
  { n: 153, lot: "lot3", section: "Boutiques claires, éditorial et couleur plate (141-155)", desc: "Grey perspective grid with a dark card floating on it and one red CTA. Depth without photography." },
  { n: 154, lot: "lot3", section: "Boutiques claires, éditorial et couleur plate (141-155)", desc: "Violet-lit dark app with review and feedback panels stacked." },
  { n: 155, lot: "lot3", section: "Boutiques claires, éditorial et couleur plate (141-155)", desc: "Dark page holding an orange card with 3D soda cans. Bright product illustration on a dark surface." },
  { n: 156, lot: "lot3", section: "3D, dégradés violets et outils sombres (156-170)", desc: "Pure white studio shot of red and white high-tops, soft contact shadow. Clean cutout source." },
  { n: 157, lot: "lot3", section: "3D, dégradés violets et outils sombres (156-170)", desc: "Dark editor with terminal output. Technical texture, keep it below the fold." },
  { n: 158, lot: "lot3", section: "3D, dégradés violets et outils sombres (156-170)", desc: "Pastel 3D scene: soft plastic blocks and a small figure, even studio light. The toy-render register kept adult by restraint." },
  { n: 159, lot: "lot3", section: "3D, dégradés violets et outils sombres (156-170)", desc: "Grey page, white text card, dark device photo behind. Studio-agency layout." },
  { n: 160, lot: "lot3", section: "3D, dégradés violets et outils sombres (156-170)", desc: "Violet → magenta gradient wave with a single one-word headline. One object on a gradient." },
  { n: 161, lot: "lot3", section: "3D, dégradés violets et outils sombres (156-170)", desc: "Dark centred input card with a question above it, small model chips below. The AI-hero skeleton in dark." },
  { n: 162, lot: "lot3", section: "3D, dégradés violets et outils sombres (156-170)", desc: "Deep navy field with a liquid chrome wave and a small centred wordmark." },
  { n: 163, lot: "lot3", section: "3D, dégradés violets et outils sombres (156-170)", desc: "Light app demo with hand-drawn arrows and a plane doodle over the screenshot. Annotation as illustration." },
  { n: 164, lot: "lot3", section: "3D, dégradés violets et outils sombres (156-170)", desc: "Purple field with three glowing phone screens standing in a row, soft reflections." },
  { n: 165, lot: "lot3", section: "3D, dégradés violets et outils sombres (156-170)", desc: "Dark navy page with diagonal metallic streaks behind centred type. Cheap depth, expensive look." },
  { n: 166, lot: "lot3", section: "3D, dégradés violets et outils sombres (156-170)", desc: "Violet field with four pastel phone screens and a wordmark under them." },
  { n: 167, lot: "lot3", section: "3D, dégradés violets et outils sombres (156-170)", desc: "Multi-pane dark terminal wall. Texture only." },
  { n: 168, lot: "lot3", section: "3D, dégradés violets et outils sombres (156-170)", desc: "Dark media UI with two cinematic stills side by side and thin controls." },
  { n: 169, lot: "lot3", section: "3D, dégradés violets et outils sombres (156-170)", desc: "White page: headline, CTA, then a photo grid and review row. The straightforward converting layout." },
  { n: 170, lot: "lot3", section: "3D, dégradés violets et outils sombres (156-170)", desc: "Dark design-tool canvas with a full landing page rendered inside it. Use for a \"built with\" page." },
  { n: 171, lot: "lot3", section: "Galeries, illustration psychédélique, champs de couleur (171-185)", desc: "White gallery of many small site cards. Grid density as the design." },
  { n: 172, lot: "lot3", section: "Galeries, illustration psychédélique, champs de couleur (171-185)", desc: "Dark psychedelic illustration with a creature and a cream text card floating on it. Drawn world, adult execution." },
  { n: 173, lot: "lot3", section: "Galeries, illustration psychédélique, champs de couleur (171-185)", desc: "Pink/red editorial photo of two people with a caption laid across the image." },
  { n: 174, lot: "lot3", section: "Galeries, illustration psychédélique, champs de couleur (171-185)", desc: "Dark perspective mockups of violet app screens plus one logo. Product parade in the void." },
  { n: 175, lot: "lot3", section: "Galeries, illustration psychédélique, champs de couleur (171-185)", desc: "Pastel cyan/pink mockup set with a poster and a gradient sphere. Print-and-screen mixed." },
  { n: 176, lot: "lot3", section: "Galeries, illustration psychédélique, champs de couleur (171-185)", desc: "Olive film still with a caption card and chips at the bottom. Cinematic frame turned into UI." },
  { n: 177, lot: "lot3", section: "Galeries, illustration psychédélique, champs de couleur (171-185)", desc: "White awards page with one soft orange blob and a centred serif title." },
  { n: 178, lot: "lot3", section: "Galeries, illustration psychédélique, champs de couleur (171-185)", desc: "Orange page framing a browser card with an interior/flower shop inside it." },
  { n: 179, lot: "lot3", section: "Galeries, illustration psychédélique, champs de couleur (171-185)", desc: "Pink page with a violet gradient card and one short centred headline." },
  { n: 180, lot: "lot3", section: "Galeries, illustration psychédélique, champs de couleur (171-185)", desc: "Deep red page with a pleated fan photo and a soft serif line. Colour + one texture." },
  { n: 181, lot: "lot3", section: "Galeries, illustration psychédélique, champs de couleur (171-185)", desc: "Dark design-tool inspector panels. Components reference for a dark UI page." },
  { n: 182, lot: "lot3", section: "Galeries, illustration psychédélique, champs de couleur (171-185)", desc: "Orange → pink → violet mesh gradient with a single wordmark. The canonical mesh plate." },
  { n: 183, lot: "lot3", section: "Galeries, illustration psychédélique, champs de couleur (171-185)", desc: "White minimal page with one thin concentric-circle diagram and small caps type. Silence as luxury." },
  { n: 184, lot: "lot3", section: "Galeries, illustration psychédélique, champs de couleur (171-185)", desc: "Aerial photo of two people on a picnic blanket with a line of text over the grass." },
  { n: 185, lot: "lot3", section: "Galeries, illustration psychédélique, champs de couleur (171-185)", desc: "White minimal form: one question, one input, one blue button, one small mark. Utility page as a poster." },
  { n: 186, lot: "lot3", section: "Dégradés Stripe-like, animalier, chiffres géants (186-200)", desc: "Dark inspiration gallery: headline, filters, grid of cards." },
  { n: 187, lot: "lot3", section: "Dégradés Stripe-like, animalier, chiffres géants (186-200)", desc: "Grey still-life of stone and ceramic objects, soft directional light. Material study." },
  { n: 188, lot: "lot3", section: "Dégradés Stripe-like, animalier, chiffres géants (186-200)", desc: "Dark hero, two-line sentence, thin nav, one pill CTA. The clean dark SaaS skeleton." },
  { n: 189, lot: "lot3", section: "Dégradés Stripe-like, animalier, chiffres géants (186-200)", desc: "Violet gradient with a phone mockup and a big two-word title." },
  { n: 190, lot: "lot3", section: "Dégradés Stripe-like, animalier, chiffres géants (186-200)", desc: "Black page with a row of cinematic portraits under a giant two-weight wordmark." },
  { n: 191, lot: "lot3", section: "Dégradés Stripe-like, animalier, chiffres géants (186-200)", desc: "Orange page with a full-bleed dog photograph and a warm rounded feature row. Colour + one animal, no gag." },
  { n: 192, lot: "lot3", section: "Dégradés Stripe-like, animalier, chiffres géants (186-200)", desc: "Peach collage page: cut-out photos, small stickers, mixed type sizes. The scrapbook register kept tidy." },
  { n: 193, lot: "lot3", section: "Dégradés Stripe-like, animalier, chiffres géants (186-200)", desc: "White page, big title, one tilted violet/pink gradient plate. Gradient as a single object." },
  { n: 194, lot: "lot3", section: "Dégradés Stripe-like, animalier, chiffres géants (186-200)", desc: "Dark task app: label list, project chips, minimal cards." },
  { n: 195, lot: "lot3", section: "Dégradés Stripe-like, animalier, chiffres géants (186-200)", desc: "Black page with giant violet numerals bleeding off the edges. Stats section as a poster." },
  { n: 196, lot: "lot3", section: "Dégradés Stripe-like, animalier, chiffres géants (186-200)", desc: "Violet page, white headline, one 3D illustration, logo strip under the fold." },
  { n: 197, lot: "lot3", section: "Dégradés Stripe-like, animalier, chiffres géants (186-200)", desc: "Black page: small triangle mark, two-line title, dark cards on the right." },
  { n: 198, lot: "lot3", section: "Dégradés Stripe-like, animalier, chiffres géants (186-200)", desc: "White art page: one green arch artwork tile beside a long text column." },
  { n: 199, lot: "lot3", section: "Dégradés Stripe-like, animalier, chiffres géants (186-200)", desc: "Dark audience table with search, filters and dense rows." },
  { n: 200, lot: "lot3", section: "Dégradés Stripe-like, animalier, chiffres géants (186-200)", desc: "Pink → orange gradient with a glossy cream jar standing dead centre. Best single \"product on colour\" plate." },
  { n: 201, lot: "lot3", section: "Wordmarks, illustration plate, panier (201-215)", desc: "Cream page with a giant lowercase wordmark under a single interior photo, tiny + control top right." },
  { n: 202, lot: "lot3", section: "Wordmarks, illustration plate, panier (201-215)", desc: "Soft blurred blue/pink/orange desktop field with a small dock at the bottom edge. Pure plate." },
  { n: 203, lot: "lot3", section: "Wordmarks, illustration plate, panier (201-215)", desc: "Dark portfolio grid of project cards with one magenta accent card." },
  { n: 204, lot: "lot3", section: "Wordmarks, illustration plate, panier (201-215)", desc: "Yellow page holding a white app card with real numbers inside. Loud colour, calm card." },
  { n: 205, lot: "lot3", section: "Wordmarks, illustration plate, panier (201-215)", desc: "Black dune scene with a spiky grey 3D sphere and a small icon rail. Impossible object, ordinary UI." },
  { n: 206, lot: "lot3", section: "Wordmarks, illustration plate, panier (201-215)", desc: "Dark photograph: hands holding a translucent green bag among floating 3D objects." },
  { n: 207, lot: "lot3", section: "Wordmarks, illustration plate, panier (201-215)", desc: "Flat orange illustrated interior with figures, one caption bottom right. Drawn register, no cartoon faces." },
  { n: 208, lot: "lot3", section: "Wordmarks, illustration plate, panier (201-215)", desc: "Cream type-specimen page: dense spec table, one slider, giant family name." },
  { n: 209, lot: "lot3", section: "Wordmarks, illustration plate, panier (201-215)", desc: "Underwater blue field with a soft wordmark floating in the light." },
  { n: 210, lot: "lot3", section: "Wordmarks, illustration plate, panier (201-215)", desc: "White cart page with \"YOUR BAG\" set enormous in red, plain line items, \"Checkout ↗\" as the only accent." },
  { n: 211, lot: "lot3", section: "Wordmarks, illustration plate, panier (201-215)", desc: "White studio page: long left text column, small green card, everything else empty." },
  { n: 212, lot: "lot3", section: "Wordmarks, illustration plate, panier (201-215)", desc: "Light lookbook grid of fashion cards with prices." },
  { n: 213, lot: "lot3", section: "Wordmarks, illustration plate, panier (201-215)", desc: "Black card describing a floating pill navbar. Component note, not a design." },
  { n: 214, lot: "lot3", section: "Wordmarks, illustration plate, panier (201-215)", desc: "Dark brown page with a photo and a prompt input under one sentence." },
  { n: 215, lot: "lot3", section: "Wordmarks, illustration plate, panier (201-215)", desc: "Dark red page with pink light streaks and a centred two-line headline." },
  { n: 216, lot: "lot3", section: "Retail réel : mode, bijoux, produit (216-230)", desc: "White page, condensed three-line headline, sneaker cutout, small colour dots." },
  { n: 217, lot: "lot3", section: "Retail réel : mode, bijoux, produit (216-230)", desc: "Wedding editorial: full-bleed photo, thin serif all-caps headline, one small link." },
  { n: 218, lot: "lot3", section: "Retail réel : mode, bijoux, produit (216-230)", desc: "Warm brown jewellery hero with a cropped wrist photo and a serif title." },
  { n: 219, lot: "lot3", section: "Retail réel : mode, bijoux, produit (216-230)", desc: "Pale pink jewellery product page: photo left, price and options right. Plain and complete." },
  { n: 220, lot: "lot3", section: "Retail réel : mode, bijoux, produit (216-230)", desc: "Dark page with a violet light beam inside a rounded card, small feature cards under it." },
  { n: 221, lot: "lot3", section: "Retail réel : mode, bijoux, produit (216-230)", desc: "Light fragrance shop grid with a floating overlay window of the same products." },
  { n: 222, lot: "lot3", section: "Retail réel : mode, bijoux, produit (216-230)", desc: "Sky-blue sticker/comparison graphic with outlined display type. Loud, use only for a versus block." },
  { n: 223, lot: "lot3", section: "Retail réel : mode, bijoux, produit (216-230)", desc: "Studio setup photograph: white backdrop, two softboxes, one chair. Reference for lighting a plate." },
  { n: 224, lot: "lot3", section: "Retail réel : mode, bijoux, produit (216-230)", desc: "Dark fashion hero with four models in a row, warm rim light." },
  { n: 225, lot: "lot3", section: "Retail réel : mode, bijoux, produit (216-230)", desc: "Blue pet-shop page with a gift-card banner and a dog photo. Mass-market commerce done cleanly." },
  { n: 226, lot: "lot3", section: "Retail réel : mode, bijoux, produit (216-230)", desc: "Cream \"Meet the Makers\" editorial with two portraits and short bios." },
  { n: 227, lot: "lot3", section: "Retail réel : mode, bijoux, produit (216-230)", desc: "Dark developer event panel with JSON, framed in pink. Technical page." },
  { n: 228, lot: "lot3", section: "Retail réel : mode, bijoux, produit (216-230)", desc: "White/pink gradient chat window, minimal chrome, one message bubble." },
  { n: 229, lot: "lot3", section: "Retail réel : mode, bijoux, produit (216-230)", desc: "Black page, one short headline, dark product cards below." },
  { n: 230, lot: "lot3", section: "Retail réel : mode, bijoux, produit (216-230)", desc: "Black page with giant condensed white type filling the width and a torn photo edge." },
  { n: 231, lot: "lot3", section: "Interfaces claires, spécimens, dégradés sombres (231-245)", desc: "Navy page with glowing 3D shapes and a dark app card under the headline." },
  { n: 232, lot: "lot3", section: "Interfaces claires, spécimens, dégradés sombres (231-245)", desc: "Grass photograph with a dark rounded menu card floating on it and 3D spheres resting in the blades." },
  { n: 233, lot: "lot3", section: "Interfaces claires, spécimens, dégradés sombres (231-245)", desc: "White settings panel: appearance options, theme thumbnails, colour swatches." },
  { n: 234, lot: "lot3", section: "Interfaces claires, spécimens, dégradés sombres (231-245)", desc: "White type specimen with two giant family names and a colour strip." },
  { n: 235, lot: "lot3", section: "Interfaces claires, spécimens, dégradés sombres (231-245)", desc: "Cream fashion product page with a phone mockup of the same product beside it." },
  { n: 236, lot: "lot3", section: "Interfaces claires, spécimens, dégradés sombres (231-245)", desc: "White resources centre with pastel illustration cards and a subscribe row." },
  { n: 237, lot: "lot3", section: "Interfaces claires, spécimens, dégradés sombres (231-245)", desc: "White page with one orange/pink jagged mountain chart. Graphic as hero." },
  { n: 238, lot: "lot3", section: "Interfaces claires, spécimens, dégradés sombres (231-245)", desc: "Pale cyan page with a dark code window centred on it. Colour behind, dark object in front." },
  { n: 239, lot: "lot3", section: "Interfaces claires, spécimens, dégradés sombres (231-245)", desc: "Dark red page with a black ring of light and a centred sentence." },
  { n: 240, lot: "lot3", section: "Interfaces claires, spécimens, dégradés sombres (231-245)", desc: "Dark page with a red silky ribbon and a small light pill CTA. Single-object dark hero." },
  { n: 241, lot: "lot3", section: "Interfaces claires, spécimens, dégradés sombres (231-245)", desc: "White node canvas with video nodes wired together, magenta frame." },
  { n: 242, lot: "lot3", section: "Interfaces claires, spécimens, dégradés sombres (231-245)", desc: "Dusk city skyline photograph with a thin nav floating over it." },
  { n: 243, lot: "lot3", section: "Interfaces claires, spécimens, dégradés sombres (231-245)", desc: "Violet/blue gradient desktop with a browser window and a video-call portrait inside." },
  { n: 244, lot: "lot3", section: "Interfaces claires, spécimens, dégradés sombres (231-245)", desc: "White architecture editorial: grid of arch photographs with tiny captions." },
  { n: 245, lot: "lot3", section: "Interfaces claires, spécimens, dégradés sombres (231-245)", desc: "White fintech hero, two-line headline, dark balance card with a real figure." },
  { n: 246, lot: "lot3", section: "Marketing clair, néon, mockups (246-260)", desc: "Black page with small labels and a black-and-white portrait collage. Editorial darkness." },
  { n: 247, lot: "lot3", section: "Marketing clair, néon, mockups (246-260)", desc: "White hero with a row of avatars inside the headline line and a logo strip below." },
  { n: 248, lot: "lot3", section: "Marketing clair, néon, mockups (246-260)", desc: "Black announcement page with a line-drawn character and one pill CTA. Drawn, not cartoon." },
  { n: 249, lot: "lot3", section: "Marketing clair, néon, mockups (246-260)", desc: "White page, three-word staccato headline, pink/violet gradient dashboards stacked." },
  { n: 250, lot: "lot3", section: "Marketing clair, néon, mockups (246-260)", desc: "Photographic hero of a person in warm light with dark app panels floating on the right." },
  { n: 251, lot: "lot3", section: "Marketing clair, néon, mockups (246-260)", desc: "Light skincare grid with a red-jar photograph as the first tile." },
  { n: 252, lot: "lot3", section: "Marketing clair, néon, mockups (246-260)", desc: "Violet/magenta gradient with a dark URL input card centred. One control on colour." },
  { n: 253, lot: "lot3", section: "Marketing clair, néon, mockups (246-260)", desc: "Neon photograph: a hand reaching into rows of glowing cans. Loud colour, real light." },
  { n: 254, lot: "lot3", section: "Marketing clair, néon, mockups (246-260)", desc: "White page with product cutouts scattered in a ring around a centred headline." },
  { n: 255, lot: "lot3", section: "Marketing clair, néon, mockups (246-260)", desc: "Pale blue/violet gradient with an empty window frame. Blank canvas plate." },
  { n: 256, lot: "lot3", section: "Marketing clair, néon, mockups (246-260)", desc: "Dark engineering dashboard, dense rows, one bright CTA." },
  { n: 257, lot: "lot3", section: "Marketing clair, néon, mockups (246-260)", desc: "White editorial headline over a dark screenshot card. Light page, dark proof." },
  { n: 258, lot: "lot3", section: "Marketing clair, néon, mockups (246-260)", desc: "Sunset gradient page with a white app card overlapping it." },
  { n: 259, lot: "lot3", section: "Marketing clair, néon, mockups (246-260)", desc: "Dark page with a small floating auth card and device mockups behind." },
  { n: 260, lot: "lot3", section: "Marketing clair, néon, mockups (246-260)", desc: "White multi-device mockup fan: desktop, tablet, phone, headset. Use for a \"works everywhere\" block." },
  { n: 261, lot: "lot3", section: "Templates, 3D chaud, produit précis (261-275)", desc: "White template page: logo, title, gallery of screens." },
  { n: 262, lot: "lot3", section: "Templates, 3D chaud, produit précis (261-275)", desc: "Dark project tracker with orange accents and dense rows." },
  { n: 263, lot: "lot3", section: "Templates, 3D chaud, produit précis (261-275)", desc: "Warm orange dark page with a 3D running figure and one CTA. Dynamic 3D kept premium." },
  { n: 264, lot: "lot3", section: "Templates, 3D chaud, produit précis (261-275)", desc: "White page with an app card and a small 3D paper plane. One prop, nothing more." },
  { n: 265, lot: "lot3", section: "Templates, 3D chaud, produit précis (261-275)", desc: "White beauty editorial: two crops of a face beside thin product line drawings." },
  { n: 266, lot: "lot3", section: "Templates, 3D chaud, produit précis (261-275)", desc: "Cream portfolio page framed in orange: portrait, stats row, awards list." },
  { n: 267, lot: "lot3", section: "Templates, 3D chaud, produit précis (261-275)", desc: "Teal community board of notes, cards and video thumbnails." },
  { n: 268, lot: "lot3", section: "Templates, 3D chaud, produit précis (261-275)", desc: "Dark app screen with an email/settings panel and one primary button." },
  { n: 269, lot: "lot3", section: "Templates, 3D chaud, produit précis (261-275)", desc: "White assistant UI with a checklist of options." },
  { n: 270, lot: "lot3", section: "Templates, 3D chaud, produit précis (261-275)", desc: "Pure blue page with white form blocks on it. Wireframe on a colour field." },
  { n: 271, lot: "lot3", section: "Templates, 3D chaud, produit précis (261-275)", desc: "Black page with a grid of glossy gradient cards and a display title. Gradient pack as design." },
  { n: 272, lot: "lot3", section: "Templates, 3D chaud, produit précis (261-275)", desc: "Cream app page with soft green line graphics and one red CTA." },
  { n: 273, lot: "lot3", section: "Templates, 3D chaud, produit précis (261-275)", desc: "Dark photographic service hero with a yellow CTA and a review row." },
  { n: 274, lot: "lot3", section: "Templates, 3D chaud, produit précis (261-275)", desc: "White product page: headphone photo, options, price, blue buy button. The complete PDP." },
  { n: 275, lot: "lot3", section: "Templates, 3D chaud, produit précis (261-275)", desc: "White editorial page with a thin line illustration and a long serif title." },
  { n: 276, lot: "lot3", section: "Fond dégradé + objet unique, mode, apps sombres (276-290)", desc: "White page with a pastel gradient triangle mark under a single sentence." },
  { n: 277, lot: "lot3", section: "Fond dégradé + objet unique, mode, apps sombres (276-290)", desc: "Dark design canvas with a pink/green gradient poster being edited inside." },
  { n: 278, lot: "lot3", section: "Fond dégradé + objet unique, mode, apps sombres (276-290)", desc: "Cloud photograph desktop with small floating windows and a dock. Photography as wallpaper, UI on top." },
  { n: 279, lot: "lot3", section: "Fond dégradé + objet unique, mode, apps sombres (276-290)", desc: "Dark jungle photograph with product cards laid over it. Use when the world must show through the shop." },
  { n: 280, lot: "lot3", section: "Fond dégradé + objet unique, mode, apps sombres (276-290)", desc: "White page with a 3D interior render inside a screen mockup." },
  { n: 281, lot: "lot3", section: "Fond dégradé + objet unique, mode, apps sombres (276-290)", desc: "White fashion editorial: two full-body shots on a pale wall, tiny captions." },
  { n: 282, lot: "lot3", section: "Fond dégradé + objet unique, mode, apps sombres (276-290)", desc: "Magenta-lit photograph of two dark serum bottles. Colour light on a dark product." },
  { n: 283, lot: "lot3", section: "Fond dégradé + objet unique, mode, apps sombres (276-290)", desc: "Orange page with four pastel app screens standing in a row." },
  { n: 284, lot: "lot3", section: "Fond dégradé + objet unique, mode, apps sombres (276-290)", desc: "Dark showroom photograph in a browser with a thumbnail strip." },
  { n: 285, lot: "lot3", section: "Fond dégradé + objet unique, mode, apps sombres (276-290)", desc: "Dark green page, headline, phone mockup, coin props. Finance app in colour." },
  { n: 286, lot: "lot3", section: "Fond dégradé + objet unique, mode, apps sombres (276-290)", desc: "Orange page with a giant script word bleeding off the bottom and a \"Scroll Down ↓↓↓\" cue." },
  { n: 287, lot: "lot3", section: "Fond dégradé + objet unique, mode, apps sombres (276-290)", desc: "Black studio pair: sunglasses and a gold pendant on green. Small product, hard light." },
  { n: 288, lot: "lot3", section: "Fond dégradé + objet unique, mode, apps sombres (276-290)", desc: "Blue/violet gradient with a glossy 3D cube floating in it." },
  { n: 289, lot: "lot3", section: "Fond dégradé + objet unique, mode, apps sombres (276-290)", desc: "Dark purple messaging app, dense panels, real conversations." },
  { n: 290, lot: "lot3", section: "Fond dégradé + objet unique, mode, apps sombres (276-290)", desc: "Dark analytics page with laptop and phone mockups and magenta accents." },
  { n: 291, lot: "lot3", section: "Typographie extrême, aide, plaques dégradées (291-305)", desc: "Cream/dark article card with a helmeted portrait. Editorial card for a story page." },
  { n: 292, lot: "lot3", section: "Typographie extrême, aide, plaques dégradées (291-305)", desc: "Acid chrome rainbow poster with a huge smiling glyph. Loud graphic, adult execution." },
  { n: 293, lot: "lot3", section: "Typographie extrême, aide, plaques dégradées (291-305)", desc: "White page: ingredient claim headline over a grid of product photographs." },
  { n: 294, lot: "lot3", section: "Typographie extrême, aide, plaques dégradées (291-305)", desc: "Black page with a giant wordmark, one paragraph, a video strip below." },
  { n: 295, lot: "lot3", section: "Typographie extrême, aide, plaques dégradées (291-305)", desc: "Cyan page filled with a dense typographic manifesto in tiny type and orange notes." },
  { n: 296, lot: "lot3", section: "Typographie extrême, aide, plaques dégradées (291-305)", desc: "White/yellow help centre with big soft cards and one illustration." },
  { n: 297, lot: "lot3", section: "Typographie extrême, aide, plaques dégradées (291-305)", desc: "White page, one short promise, then a tight feature grid." },
  { n: 298, lot: "lot3", section: "Typographie extrême, aide, plaques dégradées (291-305)", desc: "Black and pink fashion collage in columns with editorial captions." },
  { n: 299, lot: "lot3", section: "Typographie extrême, aide, plaques dégradées (291-305)", desc: "Blurred dark dashboard behind a centred input card. Depth by defocus." },
  { n: 300, lot: "lot3", section: "Typographie extrême, aide, plaques dégradées (291-305)", desc: "Pink/orange gradient page with a phone mockup and a logo strip." },
  { n: 301, lot: "lot3", section: "Typographie extrême, aide, plaques dégradées (291-305)", desc: "Navy strategic dashboard with KPI cards and coloured deltas." },
  { n: 302, lot: "lot3", section: "Typographie extrême, aide, plaques dégradées (291-305)", desc: "Black and white distorted mono type over a fern photograph. Type as texture." },
  { n: 303, lot: "lot3", section: "Typographie extrême, aide, plaques dégradées (291-305)", desc: "White page with soft blue 3D clouds and one friendly sentence." },
  { n: 304, lot: "lot3", section: "Typographie extrême, aide, plaques dégradées (291-305)", desc: "Laptop mockup on dark with a pastel mesh gradient filling the screen." },
  { n: 305, lot: "lot3", section: "Typographie extrême, aide, plaques dégradées (291-305)", desc: "White page with two gradient plates side by side under a plain title." },
  { n: 306, lot: "lot3", section: "Tableaux de bord et clôture (306-310)", desc: "Dark dashboard card set with one orange KPI tile." },
  { n: 307, lot: "lot3", section: "Tableaux de bord et clôture (306-310)", desc: "Dark clusters table with blue action buttons." },
  { n: 308, lot: "lot3", section: "Tableaux de bord et clôture (306-310)", desc: "Cream fashion product page mockups: desktop plus phone, same product." },
  { n: 309, lot: "lot3", section: "Tableaux de bord et clôture (306-310)", desc: "Blue e-learning hero with flat vector illustrations and one CTA." },
  { n: 310, lot: "lot3", section: "Tableaux de bord et clôture (306-310)", desc: "Photograph of children in capes with arms raised in a field. Use inside a card only." },
];

export const LOOKBOOK_COUNT = LOOKBOOK.length;

/** Familles visuelles, pour cibler la référence selon le rôle de la page. */
const DARK = /\b(dark|black|near-black|navy|deep|noir)\b/i;
const GRADIENT = /\b(gradient|mesh|wash|colour field|color field|field)\b/i;
const PRODUCT = /\b(product|shop|cart|bag|checkout|jewellery|fashion|cutout|studio|photograph)\b/i;
const TYPE = /\b(wordmark|type|typograph|display|serif|specimen|numerals)\b/i;
const APP = /\b(app|dashboard|table|panel|settings|UI|workspace)\b/i;

function pool(role: string): LookbookEntry[] {
  const r = role.toLowerCase();
  let re: RegExp | null = null;
  if (/hero|accueil|home|landing/.test(r)) re = GRADIENT;
  else if (/product|produit|panier|cart|checkout|lookbook|boutique/.test(r)) re = PRODUCT;
  else if (/manifest|about|histoire|story|monde/.test(r)) re = TYPE;
  else if (/compte|account|dashboard|suivi|tableau/.test(r)) re = APP;
  else if (/nuit|dark|sombre/.test(r)) re = DARK;
  const sub = re ? LOOKBOOK.filter(e => re!.test(e.desc)) : LOOKBOOK;
  return sub.length >= 6 ? sub : LOOKBOOK;
}

/** Tirage déterministe (même run + même cadre → mêmes références). */
function pick(entries: LookbookEntry[], count: number, seed: number): LookbookEntry[] {
  const out: LookbookEntry[] = [];
  const used = new Set<number>();
  let s = (seed | 0) || 1;
  while (out.length < Math.min(count, entries.length)) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    const i = s % entries.length;
    if (used.has(i)) continue;
    used.add(i);
    out.push(entries[i]);
  }
  return out;
}

export function lookbookRefs(role: string, seed: number, count = 5): LookbookEntry[] {
  return pick(pool(role), count, seed);
}

/**
 * Bloc à coller dans le prompt d'un cadre : quelques références de la banque,
 * choisies pour le rôle de la page. Le modèle doit viser CES layouts.
 */
export function lookbookBlock(role: string, seed: number, count = 5): string {
  const refs = lookbookRefs(role, seed, count);
  if (!refs.length) return "";
  const body = refs.map(e => `- [${e.n}] ${e.desc}`).join("\n");
  return [
    `RÉFÉRENCES DU SKILL — la barre de qualité (${LOOKBOOK_COUNT} captures réelles de sites et d'apps`,
    `choisies par le propriétaire du skill ; voici celles qui correspondent à cette page) :`,
    body,
    "",
    "Choisis-en UNE comme cible, dis-le dans le prompt (structure, densité, place de la couleur,",
    "taille relative du titre et de l'UI), et rends-la avec le monde inventé et le produit exact.",
    "Ne recopie ni la marque, ni les mots, ni les photos de la référence : seulement le layout.",
  ].join("\n");
}
