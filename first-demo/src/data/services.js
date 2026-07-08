export const SERVICES = [
  {
    name: 'Cleanings',
    description: 'Routine checkups and cleanings to keep your smile healthy year-round.',
    durationMinutes: 30,
    depositCents: 2500,
  },
  {
    name: 'Whitening',
    description: 'Brighten your smile with safe, professional-grade whitening treatments.',
    durationMinutes: 60,
    depositCents: 5000,
  },
  {
    name: 'Invisalign',
    description: 'Straighten your teeth discreetly with custom, comfortable clear aligners.',
    durationMinutes: 45,
    depositCents: 7500,
  },
  {
    name: 'Implants',
    description: 'Restore missing teeth with durable, natural-looking dental implants.',
    durationMinutes: 60,
    depositCents: 10000,
  },
]

// No Firebase/DOM dependency — safe to import from api/ routes the same
// way api/*.js already imports src/lib/scheduling.js, so the deposit
// charged server-side always matches what the frontend displays instead
// of keeping a second price list in sync by hand.
export function depositCentsForServices(serviceNames) {
  return SERVICES.filter((s) => serviceNames.includes(s.name)).reduce((sum, s) => sum + s.depositCents, 0)
}
