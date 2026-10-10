import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import {
  Download,
  CheckCircle2,
  ExternalLink,
  Laptop,
  Puzzle,
  ShieldCheck,
  Sparkles,
  ArrowRight,
  Sliders,
  Copy,
  Check,
  Search,
  Globe,
  HelpCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

export const Route = createFileRoute("/extension")({
  head: () => ({
    meta: [
      { title: "Chrome Extension Hub — Handsfree Everywhere" },
      {
        name: "description",
        content:
          "Download and install the Handsfree Chrome Extension (Manifest V3). Use head tracking, air gestures, and voice navigation on any website, including Google Search and Wikipedia.",
      },
    ],
  }),
  component: ExtensionPage,
});

export function ExtensionPage() {
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [isExtensionDetected, setIsExtensionDetected] = useState(false);

  useEffect(() => {
    // Check if Handsfree extension content script is injected
    if (typeof window !== "undefined" && (window as any).__HANDSFREE_INJECTED__) {
      setIsExtensionDetected(true);
    }
  }, []);

  const copyChromeUrl = () => {
    navigator.clipboard.writeText("chrome://extensions");
    setCopiedUrl(true);
    setTimeout(() => setCopiedUrl(false), 2000);
  };

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8 space-y-10">
      {/* Hero Header */}
      <div className="text-center max-w-3xl mx-auto space-y-4">
        <Badge
          variant="outline"
          className="border-brand text-brand font-semibold text-xs px-3 py-1 gap-1.5"
        >
          <Puzzle className="size-3.5" /> Manifest V3 Browser Extension
        </Badge>

        <h1 className="font-display text-3xl sm:text-5xl font-bold tracking-tight text-foreground">
          Handsfree Everywhere
        </h1>

        <p className="text-base text-muted-foreground leading-relaxed">
          Take head cursor control, air gestures, and voice dictation to <strong>any website</strong> across
          the entire web—including Google Search, YouTube, Wikipedia, news portals, and online forms.
        </p>

        {/* Extension Detection Status Banner */}
        <div className="pt-2">
          {isExtensionDetected ? (
            <div className="inline-flex items-center gap-2 rounded-full bg-emerald-500/10 border border-emerald-500/30 px-4 py-1.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="size-4" /> Handsfree Extension is Active on This Browser!
            </div>
          ) : (
            <div className="inline-flex items-center gap-2 rounded-full bg-secondary/80 border border-border px-4 py-1.5 text-xs text-muted-foreground">
              <span className="size-2 rounded-full bg-amber-400" /> Ready to install on Chrome, Edge, Brave, or Arc
            </div>
          )}
        </div>

        {/* 1-Click Download Button */}
        <div className="pt-4 flex flex-col sm:flex-row items-center justify-center gap-3">
          <a href="/handsfree-extension.zip" download="handsfree-extension.zip">
            <Button
              size="lg"
              className="bg-brand text-brand-foreground hover:bg-brand/90 font-bold px-8 py-6 text-base gap-2 shadow-sm"
            >
              <Download className="size-5" /> Download Extension (.zip)
            </Button>
          </a>
          <Link to="/browse">
            <Button variant="outline" size="lg" className="py-6 text-sm">
              Try In-Browser Sandbox First
            </Button>
          </Link>
        </div>
      </div>

      {/* 3-Step Visual Installation Guide */}
      <div className="space-y-4">
        <h2 className="text-xl font-bold text-foreground text-center">
          3-Step Installation Guide (Under 60 Seconds)
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Step 1 */}
          <Card className="border-border shadow-xs">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <span className="flex size-8 items-center justify-center rounded-full bg-brand/20 text-brand font-bold text-sm">
                  1
                </span>
                <Badge variant="secondary" className="text-[10px] uppercase">
                  Unzip
                </Badge>
              </div>
              <CardTitle className="text-base mt-2">Download &amp; Extract</CardTitle>
            </CardHeader>
            <CardContent className="text-xs text-muted-foreground space-y-2">
              <p>
                Click the download button above to save <code className="text-brand font-mono">handsfree-extension.zip</code>.
              </p>
              <p>
                Unzip the file into a folder on your computer (e.g. your Downloads or Desktop folder).
              </p>
            </CardContent>
          </Card>

          {/* Step 2 */}
          <Card className="border-border shadow-xs">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <span className="flex size-8 items-center justify-center rounded-full bg-brand/20 text-brand font-bold text-sm">
                  2
                </span>
                <Badge variant="secondary" className="text-[10px] uppercase">
                  Developer Mode
                </Badge>
              </div>
              <CardTitle className="text-base mt-2">Open Extensions Manager</CardTitle>
            </CardHeader>
            <CardContent className="text-xs text-muted-foreground space-y-3">
              <p>
                Open a new tab and navigate to:
              </p>
              <div className="flex items-center gap-1.5 p-2 rounded-lg bg-secondary/80 border border-border">
                <code className="text-[11px] font-mono text-foreground flex-1">chrome://extensions</code>
                <button
                  type="button"
                  onClick={copyChromeUrl}
                  className="text-xs text-brand hover:underline flex items-center gap-1"
                >
                  {copiedUrl ? <Check className="size-3" /> : <Copy className="size-3" />}
                  {copiedUrl ? "Copied" : "Copy"}
                </button>
              </div>
              <p>
                Toggle on <strong>&ldquo;Developer mode&rdquo;</strong> in the top-right corner.
              </p>
            </CardContent>
          </Card>

          {/* Step 3 */}
          <Card className="border-border shadow-xs">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <span className="flex size-8 items-center justify-center rounded-full bg-brand/20 text-brand font-bold text-sm">
                  3
                </span>
                <Badge variant="secondary" className="text-[10px] uppercase">
                  Load Unpacked
                </Badge>
              </div>
              <CardTitle className="text-base mt-2">Load Unpacked &amp; Browse</CardTitle>
            </CardHeader>
            <CardContent className="text-xs text-muted-foreground space-y-2">
              <p>
                Click <strong>&ldquo;Load unpacked&rdquo;</strong> in the top-left and select the unzipped <code className="text-brand font-mono">extension</code> folder.
              </p>
              <p>
                The Handsfree icon will appear in your Chrome toolbar! Click it and toggle &ldquo;Enable Handsfree&rdquo;.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Universal Search Compatibility Grid */}
      <div className="space-y-4">
        <h2 className="text-xl font-bold text-foreground text-center">
          Tested Across Leading Web Platforms
        </h2>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-center">
          {[
            { name: "Google Search", desc: "Voice typing & numbered search results" },
            { name: "Wikipedia", desc: "Hands-free article reading & link traversal" },
            { name: "YouTube", desc: "Video search & dwell click play controls" },
            { name: "DuckDuckGo & Bing", desc: "Privacy search with voice dictation" },
          ].map((site) => (
            <div key={site.name} className="p-4 rounded-xl border border-border bg-card shadow-xs">
              <Search className="size-5 text-brand mx-auto mb-2" />
              <h4 className="font-semibold text-sm text-foreground">{site.name}</h4>
              <p className="text-xs text-muted-foreground mt-1">{site.desc}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Security & Privacy Guarantee */}
      <Card className="border-border bg-secondary/30 p-6">
        <div className="flex items-start gap-4">
          <ShieldCheck className="size-8 text-brand shrink-0 mt-0.5" />
          <div className="space-y-1">
            <h3 className="font-bold text-foreground text-base">Privacy-First Architecture</h3>
            <p className="text-xs text-muted-foreground leading-relaxed">
              The Handsfree extension processes 100% of camera frames and microphone audio directly
              inside your local browser sandbox using WebAssembly and the native Web Speech API. No
              video stream, camera snapshot, or voice recording is ever transmitted to an external server.
            </p>
          </div>
        </div>
      </Card>
    </div>
  );
}
