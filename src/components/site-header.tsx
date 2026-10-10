import { Link } from "@tanstack/react-router";
import {
  Sun,
  Moon,
  Accessibility,
  Building2,
  User,
  Menu,
  FileText,
  Sparkles,
  Briefcase,
  Bookmark,
  Compass,
  LogOut,
  ChevronDown,
  Mic,
} from "lucide-react";
import { AccessibilitySheetTrigger } from "./accessibility-toolbar";
import { useAppState } from "@/lib/app-state";
import { useAuth } from "@/lib/auth-context";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuGroup,
} from "@/components/ui/dropdown-menu";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
  SheetClose,
} from "@/components/ui/sheet";

const PRIMARY_NAV = [
  { to: "/browse", label: "Browser Workstation" },
  { to: "/calibration", label: "30s Calibration" },
  { to: "/evaluate", label: "Evaluation Suite" },
  { to: "/extension", label: "Chrome Extension" },
] as const;

export function SiteHeader() {
  const {
    savedJobs,
    theme,
    toggleTheme,
    voiceNavConfig,
    setVoiceNavEnabled,
    eyeTrackingConfig,
    setEyeTrackingConfig,
    gestureConfig,
    setGestureConfig,
  } = useAppState();
  const { user, isLoading, logout } = useAuth();

  const isHandsfreeMasterActive =
    voiceNavConfig.enabled || eyeTrackingConfig.enabled || gestureConfig.enabled;

  const toggleHandsfreeMaster = () => {
    const next = !isHandsfreeMasterActive;
    setVoiceNavEnabled(next);
    setEyeTrackingConfig((c) => ({ ...c, enabled: next }));
    setGestureConfig((c) => ({ ...c, enabled: next }));
  };

  return (
    <>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground focus:shadow-lg focus:outline-none focus:ring-2 focus:ring-brand"
      >
        Skip to main content
      </a>
      <header className="sticky top-0 z-40 w-full border-b border-border bg-background/90 backdrop-blur-md transition-colors">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-3 px-4 sm:px-6 lg:px-8">
          {/* Left: Brand Identity */}
          <div className="flex items-center gap-6 shrink-0">
            <Link
              to="/"
              className="flex items-center gap-2.5 group"
              aria-label="Handsfree: Voice and Webcam-Based Browsing"
            >
              <span className="flex size-9 items-center justify-center rounded-full border border-foreground/80 bg-foreground text-background text-sm font-serif font-bold transition-transform group-hover:scale-105 shadow-xs">
                Hf
              </span>
              <div className="flex flex-col">
                <div className="flex items-center gap-1.5">
                  <span className="font-serif text-xl font-bold tracking-tight text-foreground leading-none">
                    Handsfree
                  </span>
                  <span className="hidden xl:inline-block rounded-full bg-[#7BD3C2]/30 px-2 py-0.5 text-[10px] font-semibold text-foreground border border-[#7BD3C2]/50">
                    Webcam + Voice
                  </span>
                </div>
                <span className="hidden md:inline-block text-[11px] text-muted-foreground font-sans leading-none mt-1">
                  Assistive Browsing Solution
                </span>
              </div>
            </Link>
          </div>

          {/* Center: Desktop Navigation Bar */}
          <nav aria-label="Main navigation" className="hidden lg:flex items-center gap-1 shrink-0">
            {PRIMARY_NAV.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                className="whitespace-nowrap shrink-0 rounded-full px-3 py-1.5 text-xs font-medium text-muted-foreground transition-all hover:text-foreground hover:bg-secondary/80"
                activeOptions={{ exact: true }}
                activeProps={{
                  className:
                    "text-foreground font-semibold bg-secondary border border-border/70 shadow-xs",
                }}
              >
                {item.label}
              </Link>
            ))}
          </nav>

          {/* Right: Actions, Accessibility, & User Menu */}
          <div className="flex items-center gap-2 shrink-0">
            {/* Quick Hands-Free Master Switch Trigger */}
            <button
              type="button"
              onClick={toggleHandsfreeMaster}
              className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-all active:scale-95 whitespace-nowrap ${
                isHandsfreeMasterActive
                  ? "border-[#191716] bg-[#7BD3C2] text-[#141817] shadow-[1px_1px_0px_#141817] font-semibold"
                  : "border-border bg-secondary/80 text-foreground hover:bg-secondary hover:border-foreground/40"
              }`}
              aria-label={
                isHandsfreeMasterActive
                  ? "Turn off Handsfree Tracking"
                  : "Turn on Handsfree Tracking (Head, Hand & Voice)"
              }
              title={
                isHandsfreeMasterActive
                  ? "Handsfree Active: Head Tracking, Gestures & Voice listening"
                  : "Turn On Handsfree Tracking (Head, Hand & Voice)"
              }
            >
              <Mic
                className={`size-3.5 ${
                  isHandsfreeMasterActive ? "text-[#141817] animate-pulse" : "text-foreground"
                }`}
              />
              <span className="font-sans font-semibold">Handsfree</span>
              {isHandsfreeMasterActive && (
                <span className="size-1.5 rounded-full bg-[#141817] animate-ping" />
              )}
            </button>

            {/* Quick A11y Suite Trigger */}
            <AccessibilitySheetTrigger />

            {/* Post a Job Shortcut for Employers */}
            <Link
              to="/employer"
              className="hidden md:inline-flex items-center gap-1.5 rounded-full border border-foreground/70 bg-card px-3 py-1.5 text-xs font-semibold text-foreground shadow-[1px_1.5px_0px_rgba(20,24,23,0.25)] transition-all hover:bg-secondary hover:-translate-y-0.5 whitespace-nowrap shrink-0"
              title="Employer Portal & Job Posting"
            >
              <Building2 className="size-3.5 text-muted-foreground" aria-hidden="true" />
              <span>Post a job</span>
            </Link>

            {/* Quick Privacy / Help Guide */}
            <Link
              to="/privacy"
              className="hidden sm:flex size-8 items-center justify-center rounded-full border border-border text-xs font-serif font-bold text-foreground transition-colors hover:bg-secondary shrink-0"
              title="Accessibility & Privacy Guide"
              aria-label="Accessibility & Privacy Guide"
            >
              ?
            </Link>

            {/* Dark/Light Mode Toggle */}
            <button
              type="button"
              onClick={toggleTheme}
              className="flex size-8 items-center justify-center rounded-full border border-border text-foreground transition-colors hover:bg-secondary shrink-0"
              aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
              title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            >
              {theme === "dark" ? (
                <Sun className="size-3.5 text-amber-400" />
              ) : (
                <Moon className="size-3.5 text-foreground" />
              )}
            </button>

            {/* User Profile Dropdown or Sign In */}
            {!isLoading &&
              (user ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      className="flex items-center gap-2 rounded-full border border-foreground/80 bg-secondary/80 pl-1.5 pr-2.5 py-1 text-xs font-semibold text-foreground transition-all hover:bg-secondary hover:-translate-y-0.5 focus:outline-none focus:ring-2 focus:ring-brand whitespace-nowrap shrink-0"
                      aria-label="User account menu"
                    >
                      <span className="flex size-6 items-center justify-center rounded-full bg-[#7BD3C2] text-[#141817] font-serif font-bold text-xs shadow-xs">
                        {user.fullName ? user.fullName.charAt(0).toUpperCase() : "U"}
                      </span>
                      <span className="max-w-[90px] sm:max-w-[120px] truncate">
                        {user.fullName ? user.fullName.split(" ")[0] : "Account"}
                      </span>
                      <ChevronDown className="size-3 text-muted-foreground" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    align="end"
                    className="w-56 p-1.5 bg-card border border-border shadow-lg rounded-xl"
                  >
                    <DropdownMenuLabel className="px-2 py-1.5 font-normal">
                      <p className="text-xs font-bold text-foreground leading-tight truncate">
                        {user.fullName}
                      </p>
                      <p className="text-[11px] text-muted-foreground truncate">{user.email}</p>
                      <span className="mt-1.5 inline-block rounded-full bg-[#7BD3C2]/20 border border-[#7BD3C2]/50 px-2 py-0.5 text-[10px] font-semibold text-foreground">
                        {user.isAdmin
                          ? "Admin"
                          : user.role === "employer"
                            ? "Employer"
                            : "Candidate"}
                      </span>
                    </DropdownMenuLabel>
                    <DropdownMenuSeparator className="my-1" />
                    <DropdownMenuGroup>
                      <DropdownMenuItem asChild>
                        <Link
                          to="/profile"
                          className="flex items-center gap-2 px-2 py-1.5 text-xs rounded-lg cursor-pointer"
                        >
                          <User className="size-3.5 text-muted-foreground" />
                          <span>Profile &amp; Resume</span>
                        </Link>
                      </DropdownMenuItem>
                      <DropdownMenuItem asChild>
                        <Link
                          to="/applications"
                          className="flex items-center gap-2 px-2 py-1.5 text-xs rounded-lg cursor-pointer"
                        >
                          <Briefcase className="size-3.5 text-muted-foreground" />
                          <span>My Applications</span>
                        </Link>
                      </DropdownMenuItem>
                      <DropdownMenuItem asChild>
                        <Link
                          to="/saved"
                          className="flex items-center justify-between px-2 py-1.5 text-xs rounded-lg cursor-pointer"
                        >
                          <span className="flex items-center gap-2">
                            <Bookmark className="size-3.5 text-muted-foreground" />
                            <span>Saved Roles</span>
                          </span>
                          {savedJobs.length > 0 && (
                            <span className="rounded-full bg-[#7BD3C2] text-[#141817] px-1.5 text-[10px] font-bold">
                              {savedJobs.length}
                            </span>
                          )}
                        </Link>
                      </DropdownMenuItem>
                      <DropdownMenuItem asChild>
                        <Link
                          to="/career-gps"
                          className="flex items-center gap-2 px-2 py-1.5 text-xs rounded-lg cursor-pointer"
                        >
                          <Compass className="size-3.5 text-muted-foreground" />
                          <span>Career GPS &amp; AI Coach</span>
                        </Link>
                      </DropdownMenuItem>
                      <DropdownMenuItem asChild>
                        <Link
                          to="/resume-builder"
                          className="flex items-center gap-2 px-2 py-1.5 text-xs rounded-lg cursor-pointer"
                        >
                          <FileText className="size-3.5 text-muted-foreground" />
                          <span>Guided Resume Builder</span>
                        </Link>
                      </DropdownMenuItem>
                      <DropdownMenuItem asChild>
                        <Link
                          to="/resume-match"
                          className="flex items-center gap-2 px-2 py-1.5 text-xs rounded-lg cursor-pointer"
                        >
                          <Sparkles className="size-3.5 text-muted-foreground" />
                          <span>Resume Matcher</span>
                        </Link>
                      </DropdownMenuItem>
                    </DropdownMenuGroup>
                    <DropdownMenuSeparator className="my-1" />
                    <DropdownMenuItem asChild>
                      <Link
                        to="/employer"
                        className="flex items-center gap-2 px-2 py-1.5 text-xs rounded-lg cursor-pointer"
                      >
                        <Building2 className="size-3.5 text-muted-foreground" />
                        <span>Employer Portal</span>
                      </Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild>
                      <Link
                        to="/privacy"
                        className="flex items-center gap-2 px-2 py-1.5 text-xs rounded-lg cursor-pointer"
                      >
                        <FileText className="size-3.5 text-muted-foreground" />
                        <span>Accessibility &amp; Privacy</span>
                      </Link>
                    </DropdownMenuItem>
                    <DropdownMenuSeparator className="my-1" />
                    <DropdownMenuItem
                      onClick={logout}
                      className="flex items-center gap-2 px-2 py-1.5 text-xs rounded-lg text-destructive cursor-pointer hover:bg-destructive/10"
                    >
                      <LogOut className="size-3.5" />
                      <span>Sign out</span>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : (
                <div className="flex items-center gap-1.5 shrink-0">
                  <Link
                    to="/login"
                    className="rounded-full border border-border px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-secondary whitespace-nowrap"
                  >
                    Sign in
                  </Link>
                  <Link
                    to="/jobs"
                    className="rounded-full border border-[#191716] bg-[#7BD3C2] px-3.5 py-1.5 text-xs font-semibold text-[#141817] shadow-[1px_1.5px_0px_#141817] hover:bg-[#6ec2b1] whitespace-nowrap"
                  >
                    Find Jobs
                  </Link>
                </div>
              ))}

            {/* Mobile Navigation Drawer Trigger */}
            <div className="lg:hidden shrink-0">
              <Sheet>
                <SheetTrigger asChild>
                  <button
                    type="button"
                    className="flex size-8 items-center justify-center rounded-full border border-border text-foreground hover:bg-secondary"
                    aria-label="Open Navigation Menu"
                  >
                    <Menu className="size-4" />
                  </button>
                </SheetTrigger>
                <SheetContent side="right" className="w-80 p-5 bg-background">
                  <SheetHeader className="text-left border-b border-border pb-3">
                    <SheetTitle className="font-serif text-lg font-bold flex items-center gap-2">
                      <span className="flex size-7 items-center justify-center rounded-full bg-foreground text-background text-xs font-serif font-bold">
                        Hf
                      </span>
                      Handsfree Menu
                    </SheetTitle>
                  </SheetHeader>

                  <nav className="mt-4 flex flex-col gap-1.5" aria-label="Mobile Navigation">
                    <SheetClose asChild>
                      <Link
                        to="/"
                        className="flex items-center justify-between rounded-lg px-3 py-2 text-sm text-foreground hover:bg-secondary transition-colors"
                      >
                        Overview
                      </Link>
                    </SheetClose>

                    {PRIMARY_NAV.map((item) => (
                      <SheetClose asChild key={item.to}>
                        <Link
                          to={item.to}
                          className="flex items-center justify-between rounded-lg px-3 py-2 text-sm text-foreground hover:bg-secondary transition-colors"
                        >
                          <span>{item.label}</span>
                        </Link>
                      </SheetClose>
                    ))}

                    <div className="my-2 border-t border-border pt-2 flex flex-col gap-1.5">
                      <SheetClose asChild>
                        <Link
                          to="/privacy"
                          className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-foreground hover:bg-secondary"
                        >
                          <FileText className="size-4 text-muted-foreground" />
                          Accessibility &amp; Privacy Guide
                        </Link>
                      </SheetClose>
                    </div>
                  </nav>
                </SheetContent>
              </Sheet>
            </div>
          </div>
        </div>
      </header>
    </>
  );
}

export function SiteFooter() {
  return (
    <footer className="mt-16 border-t border-border bg-secondary/40">
      <div className="mx-auto max-w-7xl px-4 py-8 text-sm text-muted-foreground">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <Accessibility className="size-4 text-brand" />
              <span className="font-display text-base font-bold text-foreground">Handsfree</span>
              <span className="text-xs text-muted-foreground">
                — Voice &amp; Webcam-Based Browsing
              </span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground max-w-xl">
              Engineered for People with Physical &amp; Motor Disabilities. XIE – CSI Student Chapter • Repo Forge •
              Team Arka! (Atharva Chaudhari, Allan Fernandes, Saanvi Chamoli, Bhakti Nimaj). Problem
              Statement #2: Handsfree: Voice and Webcam-Based Browsing.
            </p>
          </div>
          <div className="text-xs text-muted-foreground flex flex-wrap gap-x-4 gap-y-1">
            <span>♿ WCAG 2.2 AA</span>
            <span>📷 Zero-Hardware Camera Cursor</span>
            <span>🎤 Continuous Voice Navigation</span>
            <span>🔒 100% Client-Side Private</span>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-xs border-t border-border/50 pt-3 text-muted-foreground">
          <span className="font-semibold text-foreground">Disability Resources & Portals:</span>
          <Link to="/privacy" hash="rights" className="hover:text-foreground underline">
            RPwD Act 2016 Basics
          </Link>
          <a
            href="https://www.swavlambancard.gov.in"
            target="_blank"
            rel="noreferrer noopener"
            className="hover:text-foreground underline"
          >
            UDID Swavlamban Card
          </a>
          <a
            href="https://ncpedp.org"
            target="_blank"
            rel="noreferrer noopener"
            className="hover:text-foreground underline"
          >
            NCPEDP (Employment Advocacy)
          </a>
          <a
            href="https://nhfdc.nic.in"
            target="_blank"
            rel="noreferrer noopener"
            className="hover:text-foreground underline"
          >
            NHFDC (Skill Loans & Aids)
          </a>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Ableo is designed for blind users, Deaf users, wheelchair users, neurodivergent people,
          and anyone with a disability. Accommodation details are employer-provided or verified. We
          never infer disability, never add accommodation claims without consent, and all disability
          information stays private by default. Information on legal rights is general and does not
          constitute formal legal advice.
        </p>
      </div>
    </footer>
  );
}
