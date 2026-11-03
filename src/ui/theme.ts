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
