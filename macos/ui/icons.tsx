// Interface icons for the Mac pages, sized by the surrounding font size.
import type { SVGProps } from "react";
import {
  AlarmClock,
  AudioLines,
  Briefcase,
  Check,
  ChevronDown,
  ChevronRight,
  Circle,
  CircleAlert,
  CircleCheck,
  CircleX,
  DollarSign,
  Download,
  Ellipsis,
  FileText,
  Folder,
  Globe,
  GripVertical,
  Heart,
  Image,
  Info,
  Laptop,
  LayoutGrid,
  Lightbulb,
  ListChecks,
  ListFilter,
  Menu,
  MessageCircle,
  Palette,
  PanelLeft,
  Pencil,
  PencilLine,
  Pin,
  PinOff,
  Plus,
  RefreshCw,
  Search,
  Settings,
  SlidersHorizontal,
  Square,
  SquareCheck,
  SquarePlay,
  SquarePlus,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  Users,
  WandSparkles,
  X,
  type LucideIcon,
} from "lucide-react";
import { GoalsIcon, LibraryIcon } from "./Chrome";

export type IconProps = SVGProps<SVGSVGElement>;

const outline = (Icon: LucideIcon) =>
  function OutlineIcon(props: IconProps) {
    return (
      <Icon
        size="1em"
        strokeWidth={1.75}
        aria-hidden="true"
        {...(props as object)}
      />
    );
  };

export const AlarmIcon = outline(AlarmClock);
export const AppGridIcon = outline(LayoutGrid);
export const AudioIcon = outline(AudioLines);
export const BriefcaseIcon = outline(Briefcase);
export const BubbleIcon = outline(MessageCircle);
export const CheckIcon = outline(Check);
export const ChevronDownIcon = outline(ChevronDown);
export const ChevronRightIcon = outline(ChevronRight);
export const CircleAlertIcon = outline(CircleAlert);
export const CircleCheckIcon = outline(CircleCheck);
export const CircleIcon = outline(Circle);
export const CircleXIcon = outline(CircleX);
export const CloseIcon = outline(X);
export const DocumentIcon = outline(FileText);
export const DollarIcon = outline(DollarSign);
export const DownloadIcon = outline(Download);
export const EllipsisIcon = outline(Ellipsis);
export const FilterIcon = outline(ListFilter);
export const FolderIcon = outline(Folder);
export const GearIcon = outline(Settings);
export const GlobeIcon = outline(Globe);
export const GripIcon = outline(GripVertical);
export const HeartIcon = outline(Heart);
export const ImageIcon = outline(Image);
export const InfoIcon = outline(Info);
export const LaptopIcon = outline(Laptop);
export const LightbulbIcon = outline(Lightbulb);
export const ListCheckIcon = outline(ListChecks);
export const MenuIcon = outline(Menu);
export const PaletteIcon = outline(Palette);
export const PencilIcon = outline(Pencil);
export const PeopleIcon = outline(Users);
export const PinIcon = outline(Pin);
export const PlusIcon = outline(Plus);
export const RefreshIcon = outline(RefreshCw);
export const ReviseIcon = outline(PencilLine);
export const SearchIcon = outline(Search);
export const SidebarIcon = outline(PanelLeft);
export const SlidersIcon = outline(SlidersHorizontal);
export const SquareCheckIcon = outline(SquareCheck);
export const SquareIcon = outline(Square);
export const SquarePlusIcon = outline(SquarePlus);
export const ThumbDownIcon = outline(ThumbsDown);
export const ThumbUpIcon = outline(ThumbsUp);
export const TrashIcon = outline(Trash2);
export const UnpinIcon = outline(PinOff);
export const VideoIcon = outline(SquarePlay);
export const WandIcon = outline(WandSparkles);

export const ShapesIcon = outline(LibraryIcon);
export const GoalBoxIcon = outline(GoalsIcon);

export function HeartFilledIcon(props: IconProps) {
  return (
    <Heart
      size="1em"
      strokeWidth={1.75}
      fill="currentColor"
      aria-hidden="true"
      {...(props as object)}
    />
  );
}

// A solid disc with the mark knocked out of it.
function solidDisc(mark: string) {
  return function SolidDiscIcon(props: IconProps) {
    return (
      <svg
        viewBox="0 0 24 24"
        width="1em"
        height="1em"
        aria-hidden="true"
        {...props}
      >
        <circle cx="12" cy="12" r="10" fill="currentColor" />
        <path
          d={mark}
          fill="none"
          stroke="var(--bg, #fff)"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  };
}
export const CircleCheckFilledIcon = solidDisc("m7.5 12.5 3 3 6-6.5");
export const CircleXFilledIcon = solidDisc("m9 9 6 6m0-6-6 6");

export function SquareCheckFilledIcon(props: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="1em"
      height="1em"
      aria-hidden="true"
      {...props}
    >
      <rect x="3" y="3" width="18" height="18" rx="4.5" fill="currentColor" />
      <path
        d="m7.5 12.5 3 3 6-6.5"
        fill="none"
        stroke="var(--bg, #fff)"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
