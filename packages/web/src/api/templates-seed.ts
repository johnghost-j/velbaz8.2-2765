// Pre-built website templates for the marketplace
// Design systems are curated defaults — they get refined by AI competitor analysis at build time
export interface TemplateDefinition {
  name: string;
  slug: string;
  description: string;
  category: string;
  industry: string;
  designSystem: {
    primaryColor: string;
    accentColor: string;
    backgroundColor: string;
    surfaceColor: string;
    textColor: string;
    mutedTextColor: string;
    borderColor: string;
    fontFamily: string;
    headingFont: string;
    borderRadius: string;
    style: string;
  };
  pages: { slug: string; title: string; description: string; pageType: string }[];
  features: string[];
  gradient: string; // for thumbnail card
  emoji: string;
}

export const TEMPLATES: TemplateDefinition[] = [
  // ─── Restaurant ────────────────────────────────────────────────────
  // Inspired by: Noma, Eleven Madison Park, Le Bernardin websites
  // Deep warm dark tones, gold accent, serif headings = fine dining trust
  {
    name: 'Saveur',
    slug: 'saveur-restaurant',
    description: 'Elegant restaurant template with menu, reservations, and gallery. Perfect for fine dining, bistros, and cafés.',
    category: 'restaurant',
    industry: 'food',
    designSystem: {
      primaryColor: '#C9A96E',   // warm gold — appetizing, premium
      accentColor: '#A0522D',    // sienna — earthy warmth, food-friendly
      backgroundColor: '#1A1512', // very dark warm brown — intimate atmosphere
      surfaceColor: '#242018',    // slightly lighter warm surface
      textColor: '#F0EBE3',       // warm cream text — softer than pure white
      mutedTextColor: '#9C9285',  // warm gray
      borderColor: '#3A332A',     // subtle warm border
      fontFamily: "'DM Sans', sans-serif",
      headingFont: "'Playfair Display', serif",  // classic editorial serif for food
      borderRadius: '6px',
      style: 'luxury-warm',
    },
    pages: [
      { slug: 'index', title: 'Home', description: 'Hero with full-bleed food photography, tagline, CTA to reserve. Featured dishes carousel. Opening hours footer (mark unknown hours/address as [To be completed] — never invent them).', pageType: 'landing' },
      { slug: 'menu', title: 'Menu', description: 'Full menu organized by category (starters, mains, desserts, drinks). Prices, dietary icons (vegan, gluten-free). Beautiful typography.', pageType: 'list' },
      { slug: 'reservations', title: 'Reservations', description: 'Reservation form: date, time, party size, name, phone, special requests. Calendar picker look. Confirmation message.', pageType: 'contact' },
      { slug: 'about', title: 'About', description: 'Chef story, restaurant philosophy, farm-to-table sourcing. Team photos. History timeline.', pageType: 'about' },
      { slug: 'gallery', title: 'Gallery', description: 'Photo grid of dishes, interior, events. Masonry layout. Lightbox on click.', pageType: 'list' },
      { slug: 'contact', title: 'Contact', description: 'Address, phone, email, embedded map placeholder. Contact form. Social links.', pageType: 'contact' },
    ],
    features: ['Menu display', 'Reservation form', 'Photo gallery', 'Opening hours', 'Chef story', 'FAQ'],
    gradient: 'linear-gradient(135deg, #1A1512 0%, #C9A96E 100%)',
    emoji: '🍽️',
  },

  // ─── SaaS ──────────────────────────────────────────────────────────
  // Inspired by: Linear, Vercel, Raycast — dark with vibrant blue accent
  // Inter for everything (the SaaS standard), subtle borders, generous radius
  {
    name: 'LaunchPad',
    slug: 'launchpad-saas',
    description: 'Modern SaaS landing page with pricing, features, FAQ, and demo CTA. Built for conversion.',
    category: 'saas',
    industry: 'technology',
    designSystem: {
      primaryColor: '#5B6CF0',   // indigo-blue — trust, technology, calm power
      accentColor: '#38BDF8',    // sky blue — fresh, modern complement
      backgroundColor: '#09090F', // near-black with blue undertone
      surfaceColor: '#12121A',    // dark surface
      textColor: '#EEEEF0',       // near-white
      mutedTextColor: '#8B8D98',  // blue-gray muted
      borderColor: '#1F1F2E',     // subtle dark border
      fontFamily: "'Inter', sans-serif",
      headingFont: "'Inter', sans-serif",
      borderRadius: '12px',
      style: 'modern-tech',
    },
    pages: [
      { slug: 'index', title: 'Home', description: 'Hero with gradient text, product screenshot, CTA. Feature grid (6 features with icons). FAQ answering real objections. Final CTA. (No invented client logos, stats or testimonials.)', pageType: 'landing' },
      { slug: 'features', title: 'Features', description: 'Detailed feature breakdown. Each feature: icon, title, description, screenshot. Comparison table vs competitors.', pageType: 'list' },
      { slug: 'pricing', title: 'Pricing', description: '3-tier pricing: Starter, Pro, Enterprise. Feature comparison table. FAQ below pricing. Annual/monthly toggle.', pageType: 'list' },
      { slug: 'about', title: 'About', description: 'Company mission, founding story, team grid with photos. Investors/partners logos. Culture values.', pageType: 'about' },
      { slug: 'blog', title: 'Blog', description: 'Blog listing with cards: title, excerpt, date, category tag. 3-column grid.', pageType: 'blog' },
      { slug: 'contact', title: 'Contact', description: 'Contact form, support email, office address. FAQ section. Live chat placeholder.', pageType: 'contact' },
    ],
    features: ['Hero with CTA', 'Feature grid', 'Pricing table', 'Blog', 'FAQ', 'Demo request'],
    gradient: 'linear-gradient(135deg, #09090F 0%, #5B6CF0 100%)',
    emoji: '🚀',
  },

  // ─── E-commerce ────────────────────────────────────────────────────
  // Inspired by: Aesop, COS, Everlane — minimal, black+white with subtle warmth
  // Sharp corners (fashion standard), serif headings for editorial feel
  {
    name: 'Vitrine',
    slug: 'vitrine-ecommerce',
    description: 'Clean e-commerce template with product grid, cart, and checkout. Ideal for fashion, accessories, and lifestyle brands.',
    category: 'ecommerce',
    industry: 'retail',
    designSystem: {
      primaryColor: '#1A1A1A',   // near-black — editorial fashion standard
      accentColor: '#C45D3E',    // terracotta — warm, sophisticated pop color
      backgroundColor: '#FAFAF8', // warm off-white (not pure white)
      surfaceColor: '#F3F2EF',    // warm light gray
      textColor: '#1A1A1A',       // near-black
      mutedTextColor: '#71706E',  // warm mid-gray
      borderColor: '#E5E4E1',     // subtle warm border
      fontFamily: "'Inter', sans-serif",
      headingFont: "'DM Serif Display', serif",
      borderRadius: '2px',        // sharp — fashion/editorial standard
      style: 'minimal-editorial',
    },
    pages: [
      { slug: 'index', title: 'Home', description: 'Full-width hero banner with new collection. Best sellers grid (4 products). Categories bar. Newsletter signup. Instagram feed placeholder.', pageType: 'landing' },
      { slug: 'shop', title: 'Shop', description: 'Product grid with filters (category, price, size, color sidebar). Product cards with image, name, price, quick-add button. Pagination.', pageType: 'list' },
      { slug: 'product', title: 'Product Detail', description: 'Large product images gallery. Title, price, description, size selector, quantity, add to cart. Related products below. Reviews section wired to real persisted reviews with an honest empty state (never seeded with invented reviews).', pageType: 'detail' },
      { slug: 'about', title: 'About', description: 'Brand story, sustainability commitment, materials sourcing. Team photo. Brand values grid.', pageType: 'about' },
      { slug: 'faq', title: 'FAQ', description: 'Accordion FAQ: shipping, returns, sizing, payment, orders. Search bar at top.', pageType: 'faq' },
      { slug: 'contact', title: 'Contact', description: 'Contact form, email, phone. Shipping info. Returns policy link.', pageType: 'contact' },
    ],
    features: ['Product grid', 'Product detail', 'Size selector', 'Cart system', 'FAQ', 'Newsletter'],
    gradient: 'linear-gradient(135deg, #1A1A1A 0%, #C45D3E 100%)',
    emoji: '🛍️',
  },

  // ─── Portfolio ─────────────────────────────────────────────────────
  // Inspired by: Brittany Chiang, Lusion, Rauno — dark, monochrome, text-first
  // Monospaced accent for developer/designer cred, neutral palette
  {
    name: 'Folio',
    slug: 'folio-portfolio',
    description: 'Minimal portfolio for creatives, designers, and freelancers. Showcase your work beautifully.',
    category: 'portfolio',
    industry: 'creative',
    designSystem: {
      primaryColor: '#E4E4E7',   // near-white as primary on dark — clean
      accentColor: '#A1A1AA',    // zinc gray — monochrome sophistication
      backgroundColor: '#09090B', // zinc-950 — pure dark
      surfaceColor: '#18181B',    // zinc-900 surface
      textColor: '#FAFAFA',       // near-white
      mutedTextColor: '#71717A',  // zinc-500
      borderColor: '#27272A',     // zinc-800
      fontFamily: "'Inter', sans-serif",
      headingFont: "'Inter', sans-serif",
      borderRadius: '8px',
      style: 'monochrome-minimal',
    },
    pages: [
      { slug: 'index', title: 'Home', description: 'Big name/title hero. Animated text or tagline. Selected works grid (3-4 projects as large cards). Brief intro paragraph. Contact CTA.', pageType: 'landing' },
      { slug: 'work', title: 'Work', description: 'Project grid: large image cards with title, category, year. Hover effects. Filter by category (branding, web, illustration).', pageType: 'list' },
      { slug: 'about', title: 'About', description: 'Photo, bio, skills list, tools used. Experience timeline. Education. Awards/recognition.', pageType: 'about' },
      { slug: 'services', title: 'Services', description: 'Service cards: icon, title, description, starting price. Process steps. FAQ.', pageType: 'list' },
      { slug: 'contact', title: 'Contact', description: 'Large contact form. Email, social links. Availability status. Location.', pageType: 'contact' },
    ],
    features: ['Project showcase', 'Category filter', 'Services list', 'About/bio', 'Contact form'],
    gradient: 'linear-gradient(135deg, #18181B 0%, #52525B 100%)',
    emoji: '🎨',
  },

  // ─── Agency ────────────────────────────────────────────────────────
  // Inspired by: Basic/Dept, Locomotive, Metalab — dark with one strong accent
  // Bold display font, high contrast, wide layouts
  {
    name: 'Pragma',
    slug: 'pragma-agency',
    description: 'Bold agency template for marketing, design, or development studios. Showcase clients and case studies.',
    category: 'agency',
    industry: 'services',
    designSystem: {
      primaryColor: '#F0F0F0',   // near-white on dark — max contrast for headings
      accentColor: '#6D5CFF',    // vibrant purple — creative energy
      backgroundColor: '#0A0A0A', // pure dark
      surfaceColor: '#141414',    // dark surface
      textColor: '#F0F0F0',       // near-white
      mutedTextColor: '#888888',  // mid gray
      borderColor: '#222222',     // subtle dark border
      fontFamily: "'Inter', sans-serif",
      headingFont: "'Syne', sans-serif",  // bold display font for agency personality
      borderRadius: '8px',
      style: 'dark-bold',
    },
    pages: [
      { slug: 'index', title: 'Home', description: 'Oversized hero text with video background. Client logos marquee. Service highlights. Case study preview cards. Stats counter (projects, clients, years).', pageType: 'landing' },
      { slug: 'services', title: 'Services', description: 'Service cards with animations. Process timeline (Discovery → Strategy → Design → Development → Launch). Tech stack icons.', pageType: 'list' },
      { slug: 'work', title: 'Case Studies', description: 'Case study cards: thumbnail, client name, industry, results achieved. Detailed view with problem/solution/result.', pageType: 'list' },
      { slug: 'team', title: 'Team', description: 'Team grid: photos, name, role, social links. Company culture section. Hiring CTA.', pageType: 'about' },
      { slug: 'blog', title: 'Insights', description: 'Blog/insights listing. Industry thought leadership. Filter by category.', pageType: 'blog' },
      { slug: 'contact', title: 'Contact', description: 'Project inquiry form: budget range, timeline, project type. Office locations. Map.', pageType: 'contact' },
    ],
    features: ['Case studies', 'Service process', 'Team grid', 'Client logos', 'Blog', 'Project inquiry'],
    gradient: 'linear-gradient(135deg, #0A0A0A 0%, #6D5CFF 100%)',
    emoji: '⚡',
  },

  // ─── Blog / Media ──────────────────────────────────────────────────
  // Inspired by: The Verge, Stratechery, Substack — clean editorial, serif headings
  // Light background, strong typographic hierarchy, blue link tradition
  {
    name: 'Chronicle',
    slug: 'chronicle-blog',
    description: 'Clean blog and media template. Perfect for content creators, journalists, and thought leaders.',
    category: 'blog',
    industry: 'media',
    designSystem: {
      primaryColor: '#1D4ED8',   // classic editorial blue
      accentColor: '#6366F1',    // indigo complement
      backgroundColor: '#FFFFFF', // pure white — clean reading
      surfaceColor: '#F8F9FA',    // barely-gray surface
      textColor: '#111827',       // near-black for readability
      mutedTextColor: '#6B7280',  // gray-500
      borderColor: '#E5E7EB',     // gray-200
      fontFamily: "'Source Serif 4', Georgia, serif",  // body in serif for reading comfort
      headingFont: "'Inter', sans-serif",    // sans-serif headings for modern editorial contrast
      borderRadius: '8px',
      style: 'editorial-clean',
    },
    pages: [
      { slug: 'index', title: 'Home', description: 'Featured article hero with large image. Latest posts grid (3 columns). Categories sidebar. Newsletter signup. Popular posts widget.', pageType: 'landing' },
      { slug: 'articles', title: 'Articles', description: 'Article listing with search bar, category filter. Card layout: featured image, title, excerpt, date, read time, author.', pageType: 'blog' },
      { slug: 'about', title: 'About', description: 'Author bio, mission statement, what we cover. Social links. Subscribe CTA.', pageType: 'about' },
      { slug: 'newsletter', title: 'Newsletter', description: 'Newsletter signup page. Previous issues archive. What to expect. Subscriber count.', pageType: 'contact' },
      { slug: 'contact', title: 'Contact', description: 'Contact form for collaborations, pitches, feedback. Social links. FAQ.', pageType: 'contact' },
    ],
    features: ['Article listing', 'Featured post', 'Newsletter signup', 'Category filter', 'Author bio', 'Search'],
    gradient: 'linear-gradient(135deg, #1D4ED8 0%, #6366F1 100%)',
    emoji: '📝',
  },

  // ─── Startup ───────────────────────────────────────────────────────
  // Inspired by: Arc, Framer, Figma — vibrant gradients on dark, rounded, playful
  // Purple-to-pink gradient hero, generous whitespace, modern sans
  {
    name: 'Ignite',
    slug: 'ignite-startup',
    description: 'High-energy startup template. Waitlist, early access, investor pitch. Built to generate hype.',
    category: 'startup',
    industry: 'technology',
    designSystem: {
      primaryColor: '#7C3AED',   // violet — innovation, creativity
      accentColor: '#DB2777',    // pink — energy, excitement
      backgroundColor: '#030014', // very deep purple-black
      surfaceColor: '#0C0926',    // dark with purple undertone
      textColor: '#F5F3FF',       // warm white with violet hint
      mutedTextColor: '#A78BFA',  // violet-400 for muted
      borderColor: '#1E1540',     // purple-tinted border
      fontFamily: "'Inter', sans-serif",
      headingFont: "'Inter', sans-serif",
      borderRadius: '16px',       // pill-like, friendly
      style: 'futuristic-gradient',
    },
    pages: [
      { slug: 'index', title: 'Home', description: 'Animated gradient hero. Bold tagline. Email waitlist form. Problem/solution section. How it works (3 steps). Early metrics/traction. Investor logos. FAQ.', pageType: 'landing' },
      { slug: 'product', title: 'Product', description: 'Product screenshots/demo. Feature deep dive. Use cases. Integration list. Roadmap timeline.', pageType: 'detail' },
      { slug: 'pricing', title: 'Pricing', description: 'Early bird pricing. 3 tiers. Comparison table. Satisfaction guarantee. FAQ.', pageType: 'list' },
      { slug: 'about', title: 'About', description: 'Founding story. Team with LinkedIn links. Backed by section. Mission/vision. Hiring positions.', pageType: 'about' },
      { slug: 'contact', title: 'Contact', description: 'Contact form. Investor inquiries. Press kit link. Social links. Office/remote info.', pageType: 'contact' },
    ],
    features: ['Waitlist form', 'Product demo', 'Pricing tiers', 'Roadmap', 'Investor section', 'FAQ'],
    gradient: 'linear-gradient(135deg, #7C3AED 0%, #DB2777 100%)',
    emoji: '💜',
  },

  // ─── Local Business ────────────────────────────────────────────────
  // Inspired by: Square, Toast, modern local business sites — warm, trustworthy
  // Light warm background, green for trust/growth, rounded for approachability
  {
    name: 'Quartier',
    slug: 'quartier-local',
    description: 'Warm, trustworthy template for local businesses: bakeries, salons, gyms, clinics, repair shops.',
    category: 'local-business',
    industry: 'local',
    designSystem: {
      primaryColor: '#16A34A',   // green-600 — trust, growth, go-action
      accentColor: '#EA580C',    // orange-600 — warm call-to-action energy
      backgroundColor: '#FAFAF9', // stone-50 — warm off-white
      surfaceColor: '#F5F5F4',    // stone-100
      textColor: '#1C1917',       // stone-900 — warm black
      mutedTextColor: '#78716C',  // stone-500
      borderColor: '#E7E5E4',     // stone-200
      fontFamily: "'DM Sans', sans-serif",   // friendly, readable
      headingFont: "'DM Sans', sans-serif",
      borderRadius: '12px',       // rounded = approachable
      style: 'warm-trustworthy',
    },
    pages: [
      { slug: 'index', title: 'Home', description: 'Welcoming hero with photo of the business. Services overview. Location map, opening hours and contact details marked [To be completed] when not provided. CTA to book/call. (No invented reviews, address or hours.)', pageType: 'landing' },
      { slug: 'services', title: 'Services', description: 'Services grid: icon, name, description, price. Package deals highlighted. Before/after gallery if applicable.', pageType: 'list' },
      { slug: 'about', title: 'About', description: 'Owner story, team photos, years in business, certifications. Community involvement. Awards.', pageType: 'about' },
      { slug: 'reviews', title: 'Reviews', description: 'Reviews page wired to real persisted reviews (stars, name, date) with an honest empty state ("No reviews yet") plus a form for real customers to submit one. Never pre-filled with invented reviews or a fake aggregate rating.', pageType: 'list' },
      { slug: 'contact', title: 'Contact', description: 'Address, phone, email, map. Opening hours table. Booking form or phone CTA. Parking info.', pageType: 'contact' },
    ],
    features: ['Service list', 'Real customer reviews (empty until submitted)', 'Google Maps', 'Opening hours', 'Booking CTA', 'Team section'],
    gradient: 'linear-gradient(135deg, #16A34A 0%, #EA580C 100%)',
    emoji: '🏪',
  },

  // ─── Fitness / Wellness ────────────────────────────────────────────
  // Inspired by: Peloton, Barry's, ClassPass — dark with high-energy red/coral accent
  // Strong condensed headings, dark background for intensity
  {
    name: 'Pulse',
    slug: 'pulse-fitness',
    description: 'Energetic fitness & wellness template. Perfect for gyms, yoga studios, personal trainers, and wellness centers.',
    category: 'fitness',
    industry: 'health',
    designSystem: {
      primaryColor: '#DC2626',   // red-600 — energy, power, urgency
      accentColor: '#FB923C',    // orange-400 — warmth, motivation
      backgroundColor: '#0A0A0A', // near-black
      surfaceColor: '#161616',    // dark surface
      textColor: '#FAFAFA',       // near-white
      mutedTextColor: '#A1A1AA',  // zinc-400
      borderColor: '#262626',     // zinc-800
      fontFamily: "'Inter', sans-serif",
      headingFont: "'Bebas Neue', sans-serif",  // condensed uppercase — classic fitness/sports
      borderRadius: '6px',        // slightly sharp — athletic edge
      style: 'dark-energetic',
    },
    pages: [
      { slug: 'index', title: 'Home', description: 'Bold hero with action shot. Class schedule preview. Trainer highlights. Membership tiers quick view. Transformation stories. CTA to join.', pageType: 'landing' },
      { slug: 'classes', title: 'Classes', description: 'Class schedule grid by day/time. Class descriptions: difficulty, duration, trainer, what to bring. Filter by type.', pageType: 'list' },
      { slug: 'trainers', title: 'Trainers', description: 'Trainer profiles: photo, specialties, certifications, bio, schedule. Book a session CTA for each.', pageType: 'list' },
      { slug: 'membership', title: 'Membership', description: 'Membership tiers: Basic, Premium, VIP. Feature comparison. Family plans. Student discount. Sign up form.', pageType: 'list' },
      { slug: 'contact', title: 'Contact', description: 'Location, hours, phone. Free trial form. Virtual tour link. Parking/transit info.', pageType: 'contact' },
    ],
    features: ['Class schedule', 'Trainer profiles', 'Membership tiers', 'Free trial form', 'Transformations', 'Location info'],
    gradient: 'linear-gradient(135deg, #DC2626 0%, #FB923C 100%)',
    emoji: '💪',
  },

  // ─── Real Estate ───────────────────────────────────────────────────
  // Inspired by: Compass, Serhant, Luxury Presence — light, clean, navy authority
  // Professional navy blue + warm gold accent, clean sans-serif
  {
    name: 'Horizon',
    slug: 'horizon-realestate',
    description: 'Sleek real estate template for agents, brokerages, and property listings.',
    category: 'real-estate',
    industry: 'real-estate',
    designSystem: {
      primaryColor: '#1E3A5F',   // deep navy — authority, trust, real estate tradition
      accentColor: '#B8860B',    // dark goldenrod — luxury, premium
      backgroundColor: '#FFFFFF', // white — clean, spacious
      surfaceColor: '#F7F8FA',    // very light blue-gray
      textColor: '#0F172A',       // slate-900 — strong dark
      mutedTextColor: '#64748B',  // slate-500
      borderColor: '#E2E8F0',     // slate-200
      fontFamily: "'Inter', sans-serif",
      headingFont: "'Plus Jakarta Sans', sans-serif",
      borderRadius: '8px',
      style: 'clean-professional',
    },
    pages: [
      { slug: 'index', title: 'Home', description: 'Search bar hero with property type/location filters. Featured listings grid. Agent spotlight. Areas served. (No invented market stats or client testimonials.)', pageType: 'landing' },
      { slug: 'listings', title: 'Listings', description: 'Property grid with filters: price range, bedrooms, type, area. Cards: photo, price, beds/baths, sqft, location. Map view toggle.', pageType: 'list' },
      { slug: 'property', title: 'Property Detail', description: 'Photo gallery, virtual tour link. Price, specs, description. Amenities list. Neighborhood info. Agent contact form. Similar properties.', pageType: 'detail' },
      { slug: 'about', title: 'About', description: 'Agency story, market expertise, years of experience. Team grid. Client success stories. Awards and certifications.', pageType: 'about' },
      { slug: 'contact', title: 'Contact', description: 'Contact form for inquiries. Office locations. Agent directory. Free market evaluation CTA.', pageType: 'contact' },
    ],
    features: ['Property listings', 'Search/filters', 'Property detail', 'Agent profiles', 'Inquiry form'],
    gradient: 'linear-gradient(135deg, #1E3A5F 0%, #B8860B 100%)',
    emoji: '🏠',
  },
];
