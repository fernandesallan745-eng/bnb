import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  useRouterState,
  HeadContent,
  Scripts,
  type ErrorComponentProps,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { AppStateProvider } from "../lib/app-state";
import { AuthProvider } from "../lib/auth-context";
import { SiteFooter, SiteHeader } from "../components/site-header";
import { Toaster } from "../components/ui/sonner";
import { CareerAssistant } from "../components/career-assistant";
import { PortalGate } from "../components/portal-gate";
import { LiveCaptions } from "../components/live-captions";
import { VoiceAssistantModal } from "../components/voice-assistant-modal";
import { JarvisVoiceHud } from "../components/jarvis-voice-hud";
import { ReadingRuler } from "../components/reading-ruler";
import { HandGestureIndicator } from "../components/hand-gesture-indicator";
import { EyeGazeOverlay } from "../components/eye-gaze-overlay";
import { reportLovableError } from "../lib/lovable-error-reporting";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: ErrorComponentProps) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Handsfree — Voice and Webcam-Based Browsing" },
      {
        name: "description",
        content:
          "Handsfree: Assistive browsing solution that lets users interact with websites using a standard webcam and microphone, without specialized hardware. Head & hand cursor control, voice navigation, and dictation.",
      },
      { property: "og:title", content: "Handsfree — Voice and Webcam-Based Browsing" },
      {
        property: "og:description",
        content:
          "Webcam tracking and voice recognition for accessible web interaction. Point with head or hands, navigate with voice commands, and dictate into any search bar.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "Handsfree — Voice and Webcam-Based Browsing" },
      {
        name: "twitter:description",
        content:
          "Webcam tracking and voice recognition for accessible web interaction. Zero specialized hardware required.",
      },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,500;0,6..72,600;0,6..72,700;1,6..72,400;1,6..72,600&family=Plus+Jakarta+Sans:wght@400;500;600;700&family=Outfit:wght@400;500;600;700&display=swap",
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
        <script src="/voice-nav.js" data-voice-nav-server="http://localhost:3001" defer></script>
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const isPublicPage =
    pathname === "/" ||
    pathname === "/login" ||
    pathname === "/privacy" ||
    pathname === "/browse" ||
    pathname === "/calibration" ||
    pathname === "/evaluate" ||
    pathname === "/extension";
  const requiredRole = pathname.startsWith("/employer") ? "employer" : "candidate";

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <AppStateProvider>
          <div className="flex min-h-dvh flex-col bg-background text-foreground">
            <SiteHeader />
            <main id="main" className="flex-1">
              {/* Handsfree tools, browser, evaluation, and landing are publicly accessible */}
              {isPublicPage ? (
                <Outlet />
              ) : (
                <PortalGate role={requiredRole}>
                  <Outlet />
                </PortalGate>
              )}
            </main>
            <SiteFooter />
            <LiveCaptions />
            <JarvisVoiceHud />
            <VoiceAssistantModal />
            <ReadingRuler />
            <HandGestureIndicator />
            <EyeGazeOverlay />
            <CareerAssistant />
            <Toaster />
          </div>
        </AppStateProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}
