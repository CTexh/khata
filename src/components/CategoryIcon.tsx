import { categorySlug } from "@/lib/category-style";

// Drawn icons rather than emoji. Emoji are rendered by the phone, so the same
// category looked different on every device - and at the size these are shown,
// most of them read as coloured mush. These are line drawings on a 24 grid,
// stroked in the current colour, so each one takes its category's colour and
// stays crisp at any size.
type IconProps = { size?: number; className?: string };

const base = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

const icon = (paths: React.ReactNode) =>
  function Icon({ size = 22, className }: IconProps) {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden>
        {paths}
      </svg>
    );
  };

export const TagIcon = icon(
  <>
    <path {...base} d="M4 11.2V5a1 1 0 0 1 1-1h6.2a2 2 0 0 1 1.4.6l7 7a2 2 0 0 1 0 2.8l-5.4 5.4a2 2 0 0 1-2.8 0l-7-7a2 2 0 0 1-.4-1.6z" />
    <circle cx="8" cy="8" r="1.4" fill="currentColor" />
  </>
);

export const QuestionIcon = icon(
  <>
    <circle {...base} cx="12" cy="12" r="8.5" />
    <path {...base} d="M9.6 9.4a2.5 2.5 0 0 1 4.8.9c0 1.7-2.4 2-2.4 3.5" />
    <circle cx="12" cy="17" r="1" fill="currentColor" />
  </>
);

export const FamilyIcon = icon(
  <>
    <circle {...base} cx="8.5" cy="8" r="2.8" />
    <circle {...base} cx="16.5" cy="9.5" r="2.2" />
    <path {...base} d="M3.5 19.5c0-2.8 2.2-5 5-5s5 2.2 5 5" />
    <path {...base} d="M14.8 19.5c0-2.2 1.3-4.2 3.2-4.2 1.3 0 2.5.9 3 2.3" />
  </>
);

export const DonationIcon = icon(
  <>
    <path {...base} d="M12 9.6c1-1.6 3.6-1.4 4.2.4.5 1.5-1.2 3-4.2 4.8-3-1.8-4.7-3.3-4.2-4.8.6-1.8 3.2-2 4.2-.4z" />
    <path {...base} d="M4 16.5c1.6 2 4.4 3.3 8 3.3s6.4-1.3 8-3.3" />
  </>
);

export const CartIcon = icon(
  <>
    <path {...base} d="M3 4.5h2.2l2.1 9.6a1.6 1.6 0 0 0 1.6 1.3h7.6a1.6 1.6 0 0 0 1.6-1.2L19.8 8H6.2" />
    <circle {...base} cx="9.5" cy="19" r="1.3" />
    <circle {...base} cx="16.5" cy="19" r="1.3" />
  </>
);

export const DiningIcon = icon(
  <>
    <path {...base} d="M6.5 3.5v7a2 2 0 0 0 4 0v-7M8.5 3.5v7M8.5 12.5v8" />
    <path {...base} d="M17 3.5c-1.6 1-2.5 2.7-2.5 4.8s.9 3.4 2.5 3.7v8.5" />
  </>
);

export const CarIcon = icon(
  <>
    <path {...base} d="M4 15.5v3h2.8v-3M17.2 15.5v3H20v-3" />
    <path {...base} d="M3.8 15.5v-3l1.8-4.3A1.6 1.6 0 0 1 7.1 7h9.8a1.6 1.6 0 0 1 1.5 1.2l1.8 4.3v3z" />
    <path {...base} d="M4.5 12.3h15" />
    <circle cx="7.6" cy="14" r="1" fill="currentColor" />
    <circle cx="16.4" cy="14" r="1" fill="currentColor" />
  </>
);

export const LaptopIcon = icon(
  <>
    <rect {...base} x="4" y="5" width="16" height="10" rx="1.8" />
    <path {...base} d="M2.5 18.5h19" />
  </>
);

export const ShoppingBagIcon = icon(
  <>
    <path {...base} d="M5.5 8h13l-1 11.5a1.5 1.5 0 0 1-1.5 1.3H8a1.5 1.5 0 0 1-1.5-1.3z" />
    <path {...base} d="M9 10V7a3 3 0 0 1 6 0v3" />
  </>
);

export const ScissorsIcon = icon(
  <>
    <circle {...base} cx="6.5" cy="17.5" r="2.5" />
    <circle {...base} cx="17.5" cy="17.5" r="2.5" />
    <path {...base} d="M8.3 15.7 18 4M15.7 15.7 6 4" />
  </>
);

export const FilmIcon = icon(
  <>
    <rect {...base} x="3.5" y="5" width="17" height="14" rx="2" />
    <path {...base} d="M8 5v14M16 5v14M3.5 12h17" />
  </>
);

export const MedicalIcon = icon(
  <>
    <rect {...base} x="3.2" y="8.5" width="17.6" height="7" rx="3.5" transform="rotate(-45 12 12)" />
    <path {...base} d="M9.5 9.5 14.5 14.5" />
  </>
);

export const RecurringIcon = icon(
  <>
    <path {...base} d="M4.5 12a7.5 7.5 0 0 1 12.4-5.7" />
    <path {...base} d="M17.2 3.6v3.4h-3.4" />
    <path {...base} d="M19.5 12a7.5 7.5 0 0 1-12.4 5.7" />
    <path {...base} d="M6.8 20.4V17h3.4" />
  </>
);

export const TrendIcon = icon(
  <>
    <path {...base} d="M4 16.5 9.5 11l3.5 3.2L20 7.5" />
    <path {...base} d="M15.5 7.5H20v4.3" />
    <path {...base} d="M3.5 20.3h17" />
  </>
);

export const HouseIcon = icon(
  <>
    <path {...base} d="M4 10.7 12 4.5l8 6.2V19a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 19z" />
    <path {...base} d="M9.8 20.5v-5.8h4.4v5.8" />
  </>
);

export const BulbIcon = icon(
  <>
    <path {...base} d="M9 16.5a5.5 5.5 0 1 1 6 0v1.8H9z" />
    <path {...base} d="M9.8 20.8h4.4" />
  </>
);

export const PlaneIcon = icon(
  <path {...base} d="M10.5 3.7a1.5 1.5 0 0 1 3 0V9l7 4v2l-7-2v4l2 1.6v1.7l-3.5-1-3.5 1v-1.7L10.5 17v-4l-7 2v-2l7-4z" />
);

export const FuelIcon = icon(
  <>
    <path {...base} d="M5 20.5V5.5A1.5 1.5 0 0 1 6.5 4h5A1.5 1.5 0 0 1 13 5.5v15" />
    <path {...base} d="M3.8 20.5h10.4M6.8 9.5h4.4" />
    <path {...base} d="M13 9h3a1.8 1.8 0 0 1 1.8 1.8v5.4a1.6 1.6 0 0 0 3.2 0V9.2l-2.2-2.4" />
  </>
);

export const PhoneIcon = icon(
  <>
    <rect {...base} x="6.5" y="3" width="11" height="18" rx="2.4" />
    <path {...base} d="M10.8 17.6h2.4" />
  </>
);

export const EducationIcon = icon(
  <>
    <path {...base} d="M2.8 9.3 12 5.2l9.2 4.1L12 13.4z" />
    <path {...base} d="M6.6 11v4.6c0 1.6 2.4 2.9 5.4 2.9s5.4-1.3 5.4-2.9V11" />
    <path {...base} d="M21.2 9.3v5" />
  </>
);

export const GiftIcon = icon(
  <>
    <rect {...base} x="3.5" y="8.5" width="17" height="3.8" rx="1" />
    <path {...base} d="M5.2 12.3v6.4a1.8 1.8 0 0 0 1.8 1.8h10a1.8 1.8 0 0 0 1.8-1.8v-6.4" />
    <path {...base} d="M12 8.5v12M12 8.5C10.6 5.4 9.4 4 8.1 4a2 2 0 0 0 0 4.5M12 8.5c1.4-3.1 2.6-4.5 3.9-4.5a2 2 0 0 1 0 4.5" />
  </>
);

export const PawIcon = icon(
  <>
    <ellipse {...base} cx="7" cy="9" rx="1.8" ry="2.3" />
    <ellipse {...base} cx="11.4" cy="6.8" rx="1.8" ry="2.4" />
    <ellipse {...base} cx="16.2" cy="8.4" rx="1.8" ry="2.3" />
    <path {...base} d="M12 12.4c2.6 0 5.4 2.2 5.4 4.6 0 1.8-1.5 2.9-3.2 2.4-1.5-.5-2.9-.5-4.4 0-1.7.5-3.2-.6-3.2-2.4 0-2.4 2.8-4.6 5.4-4.6z" />
  </>
);

export const DumbbellIcon = icon(
  <>
    <path {...base} d="M3 10v4M6 8v8M18 8v8M21 10v4M6 12h12" />
  </>
);

export const ShirtIcon = icon(
  <path {...base} d="M9 3.5 12 6l3-2.5 4.5 2.6-1.8 4-2.2-.9v11H8.5v-11l-2.2.9-1.8-4z" />
);

export const BriefcaseIcon = icon(
  <>
    <rect {...base} x="3" y="7.5" width="18" height="12" rx="2" />
    <path {...base} d="M9 7.5V6a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v1.5M3 12.5h18" />
  </>
);

export const LeafIcon = icon(
  <>
    <path {...base} d="M20 4.5c.6 7.6-3 12.6-9.4 12.6-2.8 0-4.6-1.5-4.6-3.9 0-4.8 5.6-8.7 14-8.7z" />
    <path {...base} d="M4 20.5c1.6-4.2 4.6-7.4 8.8-9.5" />
  </>
);

export const CoinsIcon = icon(
  <>
    <ellipse {...base} cx="12" cy="6.8" rx="7" ry="3" />
    <path {...base} d="M5 6.8v4.4c0 1.7 3.1 3 7 3s7-1.3 7-3V6.8" />
    <path {...base} d="M5 11.2v5.6c0 1.7 3.1 3 7 3s7-1.3 7-3v-5.6" />
  </>
);

export const MailIcon = icon(
  <>
    <rect {...base} x="3" y="5.5" width="18" height="13" rx="2" />
    <path {...base} d="m3.8 7 7.2 5.4a1.7 1.7 0 0 0 2 0L20.2 7" />
  </>
);

export const WaveIcon = icon(
  <>
    <path {...base} d="M8.5 11V5.8a1.4 1.4 0 0 1 2.8 0V10" />
    <path {...base} d="M11.3 10V4.8a1.4 1.4 0 0 1 2.8 0V10" />
    <path {...base} d="M14.1 10.2V6.6a1.4 1.4 0 0 1 2.8 0v6.9c0 3.6-2.2 6.5-5.6 6.5-3 0-4.6-1.8-5.7-4.2L4.4 13a1.4 1.4 0 0 1 2.2-1.6l1.9 2.1" />
  </>
);

export const CheckIcon = icon(<path {...base} d="m5 12.5 4.5 4.5L19 7" />);

export const ClockIcon = icon(
  <>
    <circle {...base} cx="12" cy="12" r="8.5" />
    <path {...base} d="M12 7.2V12l3 1.8" />
  </>
);

export const FolderIcon = icon(
  <path {...base} d="M3.5 6.5a1.5 1.5 0 0 1 1.5-1.5h4l2 2.5h8a1.5 1.5 0 0 1 1.5 1.5v9a1.5 1.5 0 0 1-1.5 1.5H5a1.5 1.5 0 0 1-1.5-1.5z" />
);

export const DownloadIcon = icon(
  <>
    <path {...base} d="M12 4v10M8 10.5l4 4 4-4" />
    <path {...base} d="M4.5 16.5v2A1.5 1.5 0 0 0 6 20h12a1.5 1.5 0 0 0 1.5-1.5v-2" />
  </>
);

// The exact categories the app ships with.
const BY_SLUG: Record<string, ReturnType<typeof icon>> = {
  uncategorised: QuestionIcon,
  family: FamilyIcon,
  donations: DonationIcon,
  groceries: CartIcon,
  "food-dining": DiningIcon,
  car: CarIcon,
  tech: LaptopIcon,
  shopping: ShoppingBagIcon,
  "personal-care": ScissorsIcon,
  entertainment: FilmIcon,
  medical: MedicalIcon,
  subscriptions: RecurringIcon,
  investment: TrendIcon,
  rent: HouseIcon,
  "bills-utilities": BulbIcon,
};

// A few words, so a category someone invented still gets a fitting icon.
const BY_WORD: [RegExp, ReturnType<typeof icon>][] = [
  [/travel|flight|hotel|trip/, PlaneIcon],
  [/fuel|petrol/, FuelIcon],
  [/mobile|phone|load/, PhoneIcon],
  [/educ|school|fee|book/, EducationIcon],
  [/gift/, GiftIcon],
  [/pet/, PawIcon],
  [/gym|fitness|sport/, DumbbellIcon],
  [/cloth|fashion/, ShirtIcon],
  [/salary|income/, BriefcaseIcon],
  [/rent|house|home/, HouseIcon],
  [/food|eat|dining|restaurant/, DiningIcon],
  [/grocer|mart|store/, CartIcon],
  [/health|medic|doctor|pharm/, MedicalIcon],
  [/bill|util|electric|gas|water/, BulbIcon],
  [/invest|saving|stock/, TrendIcon],
];

export function categoryIconFor(category?: string | null) {
  const slug = categorySlug(category);
  if (!slug) return QuestionIcon;
  return BY_SLUG[slug] ?? BY_WORD.find(([re]) => re.test(slug))?.[1] ?? TagIcon;
}

export function CategoryIcon({
  category,
  size = 22,
  className,
}: {
  category?: string | null;
  size?: number;
  className?: string;
}) {
  const Icon = categoryIconFor(category);
  return <Icon size={size} className={className} />;
}
