import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useEffect, useRef } from "react";
import {
  Search,
  Mic,
  Camera,
  Globe,
  Compass,
  Sparkles,
  ExternalLink,
  Volume2,
  VolumeX,
  Sliders,
  RotateCcw,
  BookOpen,
  ArrowRight,
  CheckCircle2,
  Filter,
  Eye,
  Hand,
  Keyboard,
  Clock,
  Layers,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useAppState } from "@/lib/app-state";

export const Route = createFileRoute("/browse")({
  head: () => ({
    meta: [
      { title: "Dedicated Handsfree Browser & Search Workstation" },
      {
        name: "description",
        content:
          "Handsfree search and browsing workstation. Voice typing in search bars, head and hand cursor control, dwell clicks, and numbered voice navigation.",
      },
    ],
  }),
  component: BrowsePage,
});

type SearchResult = {
  id: number;
  title: string;
  url: string;
  domain: string;
  snippet: string;
  fullContent: string;
  category: "tech" | "health" | "accessibility" | "wiki";
  readTime: string;
};

const SAMPLE_DATABASE: SearchResult[] = [
  {
    id: 1,
    title: "Handsfree Web Browsing: Assistive Computer Vision in 2026",
    url: "https://webaccessibility.org/handsfree-browsing-breakthrough",
    domain: "webaccessibility.org",
    snippet:
      "Webcam-based facial landmarking and iris tracking now allow users with motor impairments to achieve high-precision cursor control without dedicated hardware.",
    fullContent:
      "Millions of users worldwide experience motor impairments, spinal injuries, or repetitive strain injuries (RSI) that make traditional physical mice and keyboards difficult or impossible to use. Modern browser-based machine learning models (such as MediaPipe WebAssembly) run directly on client hardware, detecting facial tilt, nose tip position, and hand gestures at 30 to 60 frames per second. Coupled with dwell-time click algorithms and natural language speech recognition, users can navigate the web entirely hands-free with zero cloud video transmission.",
    category: "accessibility",
    readTime: "3 min read",
  },
  {
    id: 2,
    title: "W3C Web Content Accessibility Guidelines (WCAG) 2.2 Overview",
    url: "https://w3.org/WAI/standards-guidelines/wcag",
    domain: "w3.org",
    snippet:
      "Understanding WCAG 2.2 success criteria for motor and physical disabilities, including target sizes, pointer gestures, and drag movements.",
    fullContent:
      "WCAG 2.2 introduces critical success criteria specifically protecting users with motor disabilities and cognitive differences. Success Criterion 2.5.8 (Target Size Minimum) mandates touch and pointer targets of at least 24 by 24 CSS pixels. Criterion 2.5.7 ensures all dragging movements can be completed via single pointer clicks. Handsfree systems leverage these standards to provide smooth numbered tag navigation and high dwell accuracy across conforming websites.",
    category: "accessibility",
    readTime: "5 min read",
  },
  {
    id: 3,
    title: "Wikipedia: Head-Mounted Displays and Vision-Based Pointing Devices",
    url: "https://en.wikipedia.org/wiki/Pointing_device",
    domain: "en.wikipedia.org",
    snippet:
      "Historical evolution of pointing devices from Douglas Engelbart's 1968 mouse to camera-based optical tracking and handsfree air-cursors.",
    fullContent:
      "A pointing device is an input interface that allows a user to input spatial data to a computer. While physical mice, trackballs, and touchpads dominated the 20th century, optical head tracking and air-gesture computing emerged as vital assistive technologies. Early systems required infrared reflectors or glasses costing thousands of dollars. Today, standard RGB webcams provide sub-pixel tracking accuracy using convolutional neural networks and landmark regression.",
    category: "wiki",
    readTime: "4 min read",
  },
  {
    id: 4,
    title: "MIT Tech Review: The Future of Zero-Hardware Assistive Tech",
    url: "https://technologyreview.com/assistive-zero-hardware-ai",
    domain: "technologyreview.com",
    snippet:
      "How browser extensions and WebAssembly democratize access for people with physical motor limitations.",
    fullContent:
      "Assistive technology has long suffered from what advocates call the 'specialized hardware tax'—specialized sip-and-puff switches or head trackers often cost upwards of $2,000 to $5,000. By shifting the workload to client-side browsers using standard commodity webcams and built-in laptop microphones, hands-free solutions achieve universal availability. Any public library computer or affordable laptop instantly transforms into an accessible workstation.",
    category: "tech",
    readTime: "4 min read",
  },
  {
    id: 5,
    title: "Speech Recognition vs Keyboard Input: Ergonomic and Velocity Studies",
    url: "https://ergonomics-journal.org/voice-dictation-efficiency-study",
    domain: "ergonomics-journal.org",
    snippet:
      "Comparative analysis showing voice dictation reaches 130-160 WPM, outperforming conventional typing while eliminating wrist strain.",
    fullContent:
      "In human-computer interaction (HCI) trials, participants utilizing voice-first search and form filling achieved search completion times 28% faster than single-finger keyboard typists. When paired with dwell confirmation or numbered link tagging, voice selection accuracy exceeded 97.4%, with accidental activation rates falling below 1.2% in controlled ambient office noise environments.",
    category: "health",
    readTime: "6 min read",
  },
  {
    id: 6,
    title: "Accessible Search Engines: Interface Design for Motor-Impaired Users",
    url: "https://inclusive-web.dev/search-interface-design-patterns",
    domain: "inclusive-web.dev",
    snippet:
      "Best practices for search bars, instant voice query transcription, pagination, and visual numbered targets.",
    fullContent:
      "Search engines represent the primary gateway to information online. Designing for motor-impaired users requires prominent search input fields with automatic focus detection, voice-query clearing ('Clear search'), audible confirmation ticks upon selection, and non-overlapping target bounding boxes.",
    category: "tech",
    readTime: "3 min read",
  },
];

export function BrowsePage() {
  const {
    eyeTrackingConfig,
    setEyeTrackingConfig,
    gestureConfig,
    setGestureConfig,
    voiceNavConfig,
    setVoiceNavEnabled,
  } = useAppState();

  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [isListeningForSearch, setIsListeningForSearch] = useState(false);
  const [showNumbers, setShowNumbers] = useState(false);
  const [activeArticle, setActiveArticle] = useState<SearchResult | null>(null);
  const [isSpeakingArticle, setIsSpeakingArticle] = useState(false);

  // Dwell Feedback Simulator
  const [dwellingCardId, setDwellingCardId] = useState<number | null>(null);
  const [dwellProgress, setDwellProgress] = useState(0);

  // Tracking Mode State
  const [trackingMode, setTrackingMode] = useState<"hybrid" | "head" | "hand" | "voice">("hybrid");
  const [lightingStatus, setLightingStatus] = useState<"Optimal" | "Low Light">("Optimal");

  // Video Ref for PIP webcam monitor
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [hasCamera, setHasCamera] = useState(false);

  // Filter Results
  const filteredResults = SAMPLE_DATABASE.filter((item) => {
    const matchesCategory = selectedCategory === "all" || item.category === selectedCategory;
    const matchesQuery =
      searchQuery.trim() === "" ||
      item.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.snippet.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesCategory && matchesQuery;
  });

  // Camera preview in PIP
  useEffect(() => {
    let stream: MediaStream | null = null;
    navigator.mediaDevices
      ?.getUserMedia({ video: { width: 320, height: 240 } })
      .then((s) => {
        stream = s;
        if (videoRef.current) {
          videoRef.current.srcObject = s;
          setHasCamera(true);
        }
      })
      .catch(() => setHasCamera(false));

    return () => {
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  // Voice Search Dictation
  const startVoiceSearch = () => {
    const SpeechRec = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRec) {
      alert("Speech Recognition API not supported in this browser. Please use Chrome or Edge.");
      return;
    }

    try {
      const rec = new SpeechRec();
      rec.continuous = false;
      rec.interimResults = true;
      rec.lang = "en-US";

      setIsListeningForSearch(true);

      rec.onresult = (e: any) => {
        const text = e.results[0][0].transcript;
        setSearchQuery(text);
      };

      rec.onend = () => {
        setIsListeningForSearch(false);
      };

      rec.onerror = () => {
        setIsListeningForSearch(false);
      };

      rec.start();
    } catch {
      setIsListeningForSearch(false);
    }
  };

  // Text-to-Speech Article Reader
  const toggleSpeechReader = (text: string) => {
    if (!window.speechSynthesis) return;

    if (isSpeakingArticle) {
      window.speechSynthesis.cancel();
      setIsSpeakingArticle(false);
    } else {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 1.0;
      utterance.onend = () => setIsSpeakingArticle(false);
      utterance.onerror = () => setIsSpeakingArticle(false);
      window.speechSynthesis.speak(utterance);
      setIsSpeakingArticle(true);
    }
  };

  // Card Dwell Interaction
  const handleCardMouseEnter = (result: SearchResult) => {
    setDwellingCardId(result.id);
    let p = 0;
    const dwellMs = eyeTrackingConfig.dwellTimeMs || 1200;
    const step = 50;
    const interval = setInterval(() => {
      p += (step / dwellMs) * 100;
      if (p >= 100) {
        clearInterval(interval);
        setDwellingCardId(null);
        setDwellProgress(0);
        setActiveArticle(result);
      } else {
        setDwellProgress(p);
      }
    }, step);
  };

  const handleCardMouseLeave = () => {
    setDwellingCardId(null);
    setDwellProgress(0);
  };

  return (
    <div className="min-h-screen bg-background pb-16">
      {/* Top Handsfree Workstation Bar */}
      <div className="sticky top-16 z-30 border-b border-border bg-card/95 backdrop-blur-md px-4 py-3 sm:px-6 lg:px-8 shadow-xs">
        <div className="mx-auto max-w-7xl flex flex-col md:flex-row items-center justify-between gap-3">
          {/* Mode Badges */}
          <div className="flex items-center gap-2 shrink-0">
            <span className="flex size-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-xs font-bold text-foreground">Handsfree Active</span>
            <Badge variant="outline" className="border-brand text-brand font-semibold text-[11px] uppercase">
              {trackingMode} Mode
            </Badge>
          </div>

          {/* Quick Voice Hints */}
          <div className="hidden lg:flex items-center gap-2 text-xs text-muted-foreground bg-secondary/60 border border-border px-3 py-1 rounded-full">
            <Sparkles className="size-3 text-brand" />
            <span>Voice commands:</span>
            <strong className="text-foreground">&ldquo;Search for [topic]&rdquo;</strong>
            <span>•</span>
            <strong className="text-foreground">&ldquo;Show numbers&rdquo;</strong>
            <span>•</span>
            <strong className="text-foreground">&ldquo;Click 2&rdquo;</strong>
            <span>•</span>
            <strong className="text-foreground">&ldquo;Scroll down&rdquo;</strong>
          </div>

          {/* Control Toggles */}
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant={showNumbers ? "default" : "outline"}
              size="sm"
              onClick={() => setShowNumbers(!showNumbers)}
              className={showNumbers ? "bg-brand text-brand-foreground font-bold" : "text-xs"}
            >
              🔢 {showNumbers ? "Hide Numbers" : "Show Numbers"}
            </Button>
            <Link to="/calibration">
              <Button type="button" variant="outline" size="sm" className="text-xs gap-1.5">
                <Sliders className="size-3" /> Calibrate (30s)
              </Button>
            </Link>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8 grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Main Browsing & Search Column (8 Cols) */}
        <div className="lg:col-span-8 space-y-6">
          {/* Search Box Card with Voice Typing */}
          <div className="bg-card border border-border rounded-2xl p-4 shadow-sm space-y-3">
            <div className="relative flex items-center">
              <Search className="size-5 text-muted-foreground absolute left-3.5 pointer-events-none" />
              <Input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search web or dictate query hands-free..."
                className="pl-11 pr-24 py-6 text-base font-medium rounded-xl border-border bg-background focus-visible:ring-brand"
              />
              <div className="absolute right-2 flex items-center gap-1.5">
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery("")}
                    className="text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded"
                    title="Clear query"
                  >
                    Clear
                  </button>
                )}
                <Button
                  type="button"
                  onClick={startVoiceSearch}
                  className={`size-10 rounded-lg transition-all ${
                    isListeningForSearch
                      ? "bg-rose-500 text-white animate-pulse shadow-md shadow-rose-500/30"
                      : "bg-brand text-brand-foreground hover:bg-brand/90"
                  }`}
                  aria-label="Voice typing in search bar"
                  title="Voice typing in search bar"
                >
                  <Mic className="size-4.5" />
                </Button>
              </div>
            </div>

            {isListeningForSearch && (
              <div className="flex items-center gap-2 text-xs font-semibold text-rose-500 animate-pulse px-2">
                <span className="size-2 rounded-full bg-rose-500" />
                Listening... Speak your search query now (e.g. &ldquo;Artificial intelligence in medicine&rdquo;)
              </div>
            )}

            {/* Filter Tabs */}
            <div className="flex flex-wrap gap-2 pt-1 border-t border-border/50">
              {[
                { id: "all", label: "All Web" },
                { id: "accessibility", label: "Assistive Tech" },
                { id: "wiki", label: "Wikipedia" },
                { id: "tech", label: "Technology" },
                { id: "health", label: "Ergonomics" },
              ].map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setSelectedCategory(tab.id)}
                  className={`px-3 py-1 text-xs rounded-full border transition-all ${
                    selectedCategory === tab.id
                      ? "bg-brand text-brand-foreground font-semibold border-brand shadow-xs"
                      : "bg-secondary/60 text-muted-foreground hover:text-foreground border-border"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          {/* Results Summary & Dwell Hint */}
          <div className="flex items-center justify-between text-xs text-muted-foreground px-1">
            <span>
              Showing {filteredResults.length} accessible results for{" "}
              <strong className="text-foreground">&ldquo;{searchQuery || "All"}&rdquo;</strong>
            </span>
            <span className="hidden sm:inline">Hover over any card for 1.2s to auto-dwell click</span>
          </div>

          {/* Search Result Cards */}
          <div className="space-y-4">
            {filteredResults.map((result) => {
              const isDwelling = dwellingCardId === result.id;

              return (
                <div
                  key={result.id}
                  onMouseEnter={() => handleCardMouseEnter(result)}
                  onMouseLeave={handleCardMouseLeave}
                  onClick={() => setActiveArticle(result)}
                  className={`relative p-5 rounded-2xl bg-card border transition-all cursor-pointer shadow-xs ${
                    isDwelling
                      ? "border-brand shadow-md shadow-brand/10 ring-2 ring-brand/30"
                      : "border-border hover:border-foreground/30 hover:bg-secondary/20"
                  }`}
                >
                  {/* Numbered Badge (Voice Target) */}
                  {showNumbers && (
                    <div className="absolute -top-3 -left-2 bg-slate-900 text-brand border-2 border-brand font-bold text-xs px-2 py-0.5 rounded-full shadow-lg z-10 animate-in zoom-in-75">
                      #{result.id}
                    </div>
                  )}

                  {/* Dwell Progress Ring on Card */}
                  {isDwelling && (
                    <div className="absolute top-4 right-4 flex items-center gap-1.5 bg-background/90 border border-brand/50 rounded-full px-2.5 py-1 text-[11px] font-mono text-brand font-bold shadow-xs">
                      <span>Dwell {Math.round(dwellProgress)}%</span>
                      <div className="size-3 rounded-full border-2 border-brand border-t-transparent animate-spin" />
                    </div>
                  )}

                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Globe className="size-3.5 text-brand" />
                    <span>{result.domain}</span>
                    <span>•</span>
                    <span className="flex items-center gap-1">
                      <Clock className="size-3" /> {result.readTime}
                    </span>
                  </div>

                  <h3 className="mt-1.5 font-display text-lg font-bold text-foreground group-hover:text-brand">
                    {result.title}
                  </h3>

                  <p className="mt-1.5 text-sm text-muted-foreground line-clamp-2 leading-relaxed">
                    {result.snippet}
                  </p>

                  <div className="mt-3 flex items-center justify-between pt-2 border-t border-border/40">
                    <span className="text-xs font-semibold text-brand flex items-center gap-1">
                      Read hands-free <ArrowRight className="size-3.5" />
                    </span>
                    <Badge variant="secondary" className="text-[10px] uppercase font-semibold">
                      {result.category}
                    </Badge>
                  </div>
                </div>
              );
            })}

            {filteredResults.length === 0 && (
              <div className="p-12 text-center rounded-2xl border border-dashed border-border bg-card">
                <Search className="size-8 mx-auto text-muted-foreground/40 mb-2" />
                <h4 className="text-base font-semibold text-foreground">No matching results found</h4>
                <p className="text-xs text-muted-foreground mt-1">
                  Try dictating another query using the microphone or clear filters.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setSearchQuery("")}
                  className="mt-4"
                >
                  Clear Search
                </Button>
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Live Tracking PIP & Voice Telemetry (4 Cols) */}
        <div className="lg:col-span-4 space-y-4 sticky top-36">
          {/* Picture-in-Picture Webcam Tracker */}
          <Card className="border-border shadow-sm overflow-hidden">
            <CardHeader className="py-2.5 px-3.5 bg-secondary/40 border-b border-border">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Camera className="size-3.5 text-brand" />
                  <span className="text-xs font-bold text-foreground">Webcam Mesh PIP</span>
                </div>
                <Badge variant="outline" className="text-[10px] font-mono">
                  {lightingStatus}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="p-3 space-y-3">
              <div className="relative aspect-4/3 w-full rounded-xl bg-slate-950 overflow-hidden flex items-center justify-center">
                {hasCamera ? (
                  <video
                    ref={videoRef}
                    autoPlay
                    playsInline
                    muted
                    className="w-full h-full object-cover scale-x-[-1] opacity-90"
                  />
                ) : (
                  <div className="text-center p-4 text-muted-foreground text-xs">
                    <Camera className="size-6 mx-auto mb-1 text-muted-foreground/40" />
                    Webcam feed preview
                  </div>
                )}

                {/* Overlaid Tracking Target */}
                <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                  <div className="size-16 rounded-full border border-dashed border-brand/50" />
                  <div className="absolute size-2 rounded-full bg-brand" />
                </div>
              </div>

              {/* Mode Switcher */}
              <div className="grid grid-cols-2 gap-1.5">
                {[
                  { id: "hybrid", label: "✦ Hybrid" },
                  { id: "head", label: "👤 Head Only" },
                  { id: "hand", label: "✋ Hand Only" },
                  { id: "voice", label: "🎤 Voice Only" },
                ].map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setTrackingMode(m.id as any)}
                    className={`p-2 rounded-lg text-xs font-semibold border transition-all text-center ${
                      trackingMode === m.id
                        ? "bg-brand text-brand-foreground border-brand shadow-xs"
                        : "bg-secondary/50 text-muted-foreground border-border hover:text-foreground"
                    }`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Voice Command Cheat Sheet */}
          <Card className="border-border shadow-sm p-4 space-y-3">
            <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
              <Mic className="size-3.5 text-brand" /> Handsfree Commands
            </h4>
            <div className="space-y-2 text-xs">
              <div className="p-2 rounded-lg bg-secondary/50 border border-border">
                <strong className="text-brand block">&ldquo;Search for [topic]&rdquo;</strong>
                <span className="text-muted-foreground">Dictates query into search bar</span>
              </div>
              <div className="p-2 rounded-lg bg-secondary/50 border border-border">
                <strong className="text-brand block">&ldquo;Show numbers&rdquo; / &ldquo;Click 3&rdquo;</strong>
                <span className="text-muted-foreground">Number tags all links &amp; selects target</span>
              </div>
              <div className="p-2 rounded-lg bg-secondary/50 border border-border">
                <strong className="text-brand block">&ldquo;Scroll down&rdquo; / &ldquo;Scroll up&rdquo;</strong>
                <span className="text-muted-foreground">Smooth page scrolling</span>
              </div>
              <div className="p-2 rounded-lg bg-secondary/50 border border-border">
                <strong className="text-brand block">&ldquo;Click&rdquo;</strong>
                <span className="text-muted-foreground">Clicks current cursor target</span>
              </div>
            </div>
          </Card>
        </div>
      </div>

      {/* Article Reader Modal with Text-to-Speech */}
      {activeArticle && (
        <Dialog open={!!activeArticle} onOpenChange={() => setActiveArticle(null)}>
          <DialogContent className="max-w-2xl bg-card border-border">
            <DialogHeader>
              <div className="flex items-center justify-between text-xs text-muted-foreground pb-2">
                <span>{activeArticle.domain}</span>
                <Badge variant="outline" className="text-[10px] uppercase">
                  {activeArticle.category}
                </Badge>
              </div>
              <DialogTitle className="font-display text-2xl font-bold leading-snug">
                {activeArticle.title}
              </DialogTitle>
            </DialogHeader>

            <div className="mt-4 space-y-4">
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => toggleSpeechReader(activeArticle.fullContent)}
                  className="gap-2 text-xs font-semibold"
                >
                  {isSpeakingArticle ? (
                    <>
                      <VolumeX className="size-4 text-rose-500" /> Stop Speaking
                    </>
                  ) : (
                    <>
                      <Volume2 className="size-4 text-brand" /> Read Aloud (Voice)
                    </>
                  )}
                </Button>
                {isSpeakingArticle && (
                  <span className="text-xs text-brand animate-pulse font-medium">
                    Speaking aloud...
                  </span>
                )}
              </div>

              <div className="p-4 rounded-xl bg-secondary/40 border border-border text-sm leading-relaxed text-foreground whitespace-pre-line font-sans">
                {activeArticle.fullContent}
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
