import chalk from "chalk";

export const theme = {
  brand: chalk.hex("#A78BFA"),
  accent: chalk.hex("#22D3EE"),
  success: chalk.hex("#34D399"),
  danger: chalk.hex("#F87171"),
  warning: chalk.hex("#FBBF24"),
  muted: chalk.hex("#64748B"),
  text: chalk.white,
  dim: chalk.dim,
  bold: chalk.bold,
  italic: chalk.italic,
  brandBold: chalk.hex("#A78BFA").bold,
  successBold: chalk.hex("#34D399").bold,
  dangerBold: chalk.hex("#F87171").bold,
  accentBold: chalk.hex("#22D3EE").bold,

  // Rich badges & pills for modern developer UI
  badge: (text: string, fg = "#FFFFFF", bg = "#6366F1"): string =>
    chalk.bgHex(bg).hex(fg).bold(` ${text} `),
  pill: (text: string, fg = "#38BDF8", bg = "#0F172A"): string =>
    chalk.bgHex(bg).hex(fg).bold(` ${text} `),
  pillGreen: (text: string): string => chalk.bgHex("#064E3B").hex("#34D399").bold(` ${text} `),
  pillRed: (text: string): string => chalk.bgHex("#7F1D1D").hex("#FCA5A5").bold(` ${text} `),
  pillYellow: (text: string): string => chalk.bgHex("#78350F").hex("#FDE68A").bold(` ${text} `),
  filePath: (text: string): string => chalk.hex("#38BDF8").underline(text),
};

export type MicroAnimationType = "thinking" | "analyzing" | "creating" | "verifying";

export const microSpinners: Record<MicroAnimationType, { interval: number; frames: string[] }> = {
  // Iridescent diamond star micro-animation (Thinking...)
  thinking: {
    interval: 110,
    frames: [
      chalk.hex("#FCA5A5")(" ✦ "),
      chalk.hex("#F472B6")(" ✧ "),
      chalk.hex("#A78BFA")(" ⬡ "),
      chalk.hex("#C084FC")(" ⬢ "),
      chalk.hex("#818CF8")(" ✦ "),
    ],
  },
  // Amber shifting pixel cluster (Analyzing...)
  analyzing: {
    interval: 100,
    frames: [
      chalk.hex("#FB923C")(" ▪ "),
      chalk.hex("#F97316")(" ▫ "),
      chalk.hex("#EA580C")(" ◽ "),
      chalk.hex("#C2410C")(" ◾ "),
      chalk.hex("#EA580C")(" ◼ "),
    ],
  },
  // Magenta staircase streak (Creating...)
  creating: {
    interval: 95,
    frames: [
      chalk.hex("#F472B6")(" ⠋ "),
      chalk.hex("#EC4899")(" ⠙ "),
      chalk.hex("#DB2777")(" ⠹ "),
      chalk.hex("#BE185D")(" ⠸ "),
      chalk.hex("#F472B6")(" ⠼ "),
    ],
  },
  // Orange 3x3 matrix wave (Verifying...)
  verifying: {
    interval: 115,
    frames: [
      chalk.hex("#F97316")(" ▣ "),
      chalk.hex("#FB923C")(" ▤ "),
      chalk.hex("#EA580C")(" ▥ "),
      chalk.hex("#F97316")(" ▦ "),
      chalk.hex("#FB923C")(" ▧ "),
    ],
  },
};

export const LOGO = [
  "  ██╗  ██╗██╗   ██╗███████╗██████╗ ██╗██╗  ██╗ ██████╗ ",
  "  ██║ ██╔╝██║   ██║██╔════╝██╔══██╗██║██║ ██╔╝██╔═══██╗",
  "  █████╔╝ ██║   ██║█████╗  ██████╔╝██║█████╔╝ ██║   ██║",
  "  ██╔═██╗ ██║   ██║██╔══╝  ██╔══██╗██║██╔═██╗ ██║   ██║",
  "  ██║  ██╗╚██████╔╝███████╗██████╔╝██║██║  ██╗╚██████╔╝",
  "  ╚═╝  ╚═╝ ╚═════╝ ╚══════╝╚═════╝ ╚═╝╚═╝  ╚═╝ ╚═════╝ ",
];

const LOGO_GRADIENT = ["#22D3EE", "#38BDF8", "#60A5FA", "#818CF8", "#A78BFA", "#C084FC"];

export function colorLogo(): string[] {
  return LOGO.map((line, index) => chalk.hex(LOGO_GRADIENT[index] ?? "#A78BFA")(line));
}
