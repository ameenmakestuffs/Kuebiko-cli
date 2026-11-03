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
};

export const LOGO = [
  "  █████╗ ███████╗ ██████╗ ██╗███████╗",
  "  ██╔══██╗██╔════╝██╔════╝ ██║██╔════╝",
  "  ███████║█████╗  ██║  ███╗██║███████╗",
  "  ██╔══██║██╔══╝  ██║   ██║██║╚════██║",
  "  ██║  ██║███████╗╚██████╔╝██║███████║",
  "  ╚═╝  ╚═╝╚══════╝ ╚═════╝ ╚═╝╚══════╝",
];

const LOGO_GRADIENT = ["#22D3EE", "#38BDF8", "#60A5FA", "#818CF8", "#A78BFA", "#C084FC"];

export function colorLogo(): string[] {
  return LOGO.map((line, index) => chalk.hex(LOGO_GRADIENT[index] ?? "#A78BFA")(line));
}
