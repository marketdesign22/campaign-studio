import { useAuth } from "@/_core/hooks/useAuth";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { startLogin } from "@/const";
import { useIsMobile } from "@/hooks/useMobile";
import { trpc } from "@/lib/trpc";
import { useI18n } from "@/i18n";
import { AtSign, BarChart3, CalendarDays, Check, ChevronsUpDown, Clock, FileBarChart, FileText, Languages, LayoutDashboard, LogOut, MessageCircle, PanelLeft, Settings, Compass } from "lucide-react";
import { CSSProperties, useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { AccountProvider, useAccount } from "@/contexts/AccountContext";
import { DashboardLayoutSkeleton } from './DashboardLayoutSkeleton';
import { Button } from "./ui/button";

const menuItemsV2 = [
  { icon: LayoutDashboard, label: "ダッシュボード", path: "/" },
  { icon: MessageCircle, label: "受信箱", path: "/inbox" },
  { icon: FileText, label: "投稿原稿管理", path: "/posts" },
  { icon: CalendarDays, label: "カレンダー", path: "/calendar" },
  { icon: Clock, label: "投稿履歴", path: "/history" },
  { icon: BarChart3, label: "分析", path: "/analytics" },
  { icon: Compass, label: "トレンド", path: "/trends" },
  { icon: FileBarChart, label: "月次レポート", path: "/report" },
  { icon: Settings, label: "設定", path: "/settings" },
];

/** ブランド未設定時の既定表示名（ホワイトレーベルのため特定組織名は入れない） */
const DEFAULT_BRAND_NAME = "Threads Studio";

const SIDEBAR_WIDTH_KEY = "sidebar-width";
const DEFAULT_WIDTH = 272;
const MIN_WIDTH = 200;
const MAX_WIDTH = 480;

function LangToggle({ onDark = false }: { onDark?: boolean }) {
  const { lang, setLang } = useI18n();
  return (
    <button
      onClick={() => setLang(lang === "ja" ? "en" : "ja")}
      className={`flex items-center gap-1.5 text-xs rounded-md px-2 py-1.5 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
        onDark ? "text-white/60 hover:text-white hover:bg-white/10" : "text-muted-foreground hover:text-foreground hover:bg-accent"
      }`}
      aria-label="Switch language"
    >
      <Languages className="h-3.5 w-3.5" />
      {lang === "ja" ? "English" : "日本語"}
    </button>
  );
}

/**
 * アカウント切り替え。ここで選んだアカウントが、以降すべての画面のデータ範囲になる。
 * 選択は端末に保存され、ページを移動しても維持される。
 */
function AccountSwitcher({ collapsed }: { collapsed: boolean }) {
  const { accounts, current, select } = useAccount();
  const { t } = useI18n();

  if (!current) return null;

  const initial = current.name.trim().charAt(0).toUpperCase() || "@";

  if (collapsed) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            className="mx-auto h-8 w-8 rounded-lg bg-white/10 hover:bg-white/20 transition-colors flex items-center justify-center text-[11px] font-semibold text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={t("アカウントを切り替え")}
            title={current.name}
          >
            {initial}
          </button>
        </DropdownMenuTrigger>
        <AccountMenu accounts={accounts} currentId={current.id} onSelect={select} />
      </DropdownMenu>
    );
  }

  return (
    <div className="px-3 pt-3">
      <p className="text-[10px] font-semibold tracking-[0.2em] uppercase text-white/35 mb-1.5 px-1">
        {t("アカウント")}
      </p>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            className="w-full flex items-center gap-2.5 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 px-2.5 py-2 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={t("アカウントを切り替え")}
          >
            <span className="h-6 w-6 rounded-md bg-[var(--brand-accent)] text-[#1d3450] text-[11px] font-bold flex items-center justify-center shrink-0">
              {initial}
            </span>
            <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-white">
              {current.name}
            </span>
            <ChevronsUpDown className="h-3.5 w-3.5 text-white/40 shrink-0" />
          </button>
        </DropdownMenuTrigger>
        <AccountMenu accounts={accounts} currentId={current.id} onSelect={select} />
      </DropdownMenu>
    </div>
  );
}

function AccountMenu({
  accounts,
  currentId,
  onSelect,
}: {
  accounts: { id: number; name: string; threadsUserId: string }[];
  currentId: number;
  onSelect: (id: number) => void;
}) {
  return (
    <DropdownMenuContent align="start" className="w-60">
      {accounts.map((a) => (
        <DropdownMenuItem
          key={a.id}
          onClick={() => onSelect(a.id)}
          className="cursor-pointer gap-2"
        >
          <Check className={`h-4 w-4 shrink-0 ${a.id === currentId ? "opacity-100" : "opacity-0"}`} />
          <span className="min-w-0 flex-1 truncate">{a.name}</span>
        </DropdownMenuItem>
      ))}
    </DropdownMenuContent>
  );
}

function BrandMark({ size = "md" }: { size?: "md" | "lg" }) {
  const box = size === "lg" ? "h-12 w-12 rounded-2xl" : "h-8 w-8 rounded-lg";
  const icon = size === "lg" ? "h-6 w-6" : "h-4 w-4";
  return (
    <span className={`${box} bg-[var(--brand-accent)] flex items-center justify-center shrink-0 shadow-md`}>
      <AtSign className={`${icon} text-[#1d3450]`} strokeWidth={2.4} />
    </span>
  );
}

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = localStorage.getItem(SIDEBAR_WIDTH_KEY);
    return saved ? parseInt(saved, 10) : DEFAULT_WIDTH;
  });
  const { loading, user } = useAuth();
  const { t, lang } = useI18n();
  // サインイン画面は未ログインなので公開エンドポイントからブランドを取る
  const { data: brand } = trpc.settings.brand.useQuery(undefined, { staleTime: 60_000 });
  const brandTitle = brand?.brandName || DEFAULT_BRAND_NAME;

  useEffect(() => {
    const root = document.documentElement;
    if (brand?.brandAccent) root.style.setProperty("--brand-accent", brand.brandAccent);
    else root.style.removeProperty("--brand-accent");
  }, [brand?.brandAccent]);

  useEffect(() => {
    localStorage.setItem(SIDEBAR_WIDTH_KEY, sidebarWidth.toString());
  }, [sidebarWidth]);

  if (loading) {
    return <DashboardLayoutSkeleton />
  }

  if (!user) {
    return (
      <div className="min-h-screen grid lg:grid-cols-2 relative">
        <div className="absolute top-4 right-4 z-10">
          <LangToggle />
        </div>
        {/* Brand panel */}
        <div className="hidden lg:flex flex-col justify-between bg-[oklch(0.245_0.055_248)] p-12 text-white">
          <div className="flex items-center gap-3">
            <BrandMark />
            <span className="font-display font-semibold tracking-wide">{brandTitle}</span>
          </div>
          <div>
            <p className="text-[11px] font-semibold tracking-[0.22em] uppercase text-[var(--brand-accent)] mb-4">
              Official Social Media Operations
            </p>
            <h2 className="font-display text-4xl leading-snug font-semibold">
              {lang === "ja" ? (<>毎日の発信を、<br />確かなリズムで。</>) : (<>Every day.<br />On rhythm.</>)}
            </h2>
            <p className="text-sm text-white/60 mt-5 leading-relaxed max-w-sm">
              {t("投稿の計画・自動配信・効果測定までを一つに。公式Threadsアカウントの運用ダッシュボードです。")}
            </p>
          </div>
          <p className="text-xs text-white/40">© {new Date().getFullYear()} {brandTitle}</p>
        </div>
        {/* Sign-in panel */}
        <div className="flex items-center justify-center p-8">
          <div className="flex flex-col items-center gap-8 max-w-sm w-full">
            <div className="flex flex-col items-center gap-5">
              <BrandMark size="lg" />
              <div className="text-center">
                <h1 className="font-display text-2xl font-semibold tracking-tight">
                  {brandTitle}
                </h1>
                <p className="text-sm text-muted-foreground mt-2 leading-relaxed">
                  {t("運用チームメンバーとしてサインインしてください。")}
                </p>
              </div>
            </div>
            <Button
              onClick={() => startLogin()}
              size="lg"
              variant="outline"
              className="w-full gap-3"
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
                <path fill="#4285F4" d="M23.49 12.27c0-.79-.07-1.54-.19-2.27H12v4.51h6.47c-.29 1.48-1.14 2.73-2.4 3.58v3h3.86c2.26-2.09 3.56-5.17 3.56-8.82z" />
                <path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.86-3c-1.08.72-2.45 1.16-4.07 1.16-3.13 0-5.78-2.11-6.73-4.96H1.29v3.09C3.26 21.3 7.31 24 12 24z" />
                <path fill="#FBBC05" d="M5.27 14.29c-.25-.72-.38-1.49-.38-2.29s.14-1.57.38-2.29V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.98-3.09z" />
                <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.98 3.09c.95-2.85 3.6-4.96 6.73-4.96z" />
              </svg>
              {lang === "ja" ? "Googleでサインイン" : "Sign in with Google"}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <AccountProvider>
      <SidebarProvider
        style={
          {
            "--sidebar-width": `${sidebarWidth}px`,
          } as CSSProperties
        }
      >
        <DashboardLayoutContent setSidebarWidth={setSidebarWidth}>
          {children}
        </DashboardLayoutContent>
      </SidebarProvider>
    </AccountProvider>
  );
}

type DashboardLayoutContentProps = {
  children: React.ReactNode;
  setSidebarWidth: (width: number) => void;
};

function DashboardLayoutContent({
  children,
  setSidebarWidth,
}: DashboardLayoutContentProps) {
  const { user, logout } = useAuth();
  const { t } = useI18n();
  const [location, setLocation] = useLocation();
  const { state, toggleSidebar, setOpenMobile, isMobile: sidebarIsMobile } = useSidebar();
  const isCollapsed = state === "collapsed";
  // White-label: apply brand name / accent color from settings
  const { data: brand } = trpc.settings.get.useQuery(undefined, { staleTime: 60_000 });
  const brandTitle = brand?.brandName || DEFAULT_BRAND_NAME;
  useEffect(() => {
    const root = document.documentElement;
    if (brand?.brandAccent) root.style.setProperty("--brand-accent", brand.brandAccent);
    else root.style.removeProperty("--brand-accent");
  }, [brand?.brandAccent]);
  const [isResizing, setIsResizing] = useState(false);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const activeMenuItem = menuItemsV2.find(item => item.path === location);
  const { current: currentAccount, hasAccounts, isLoading: accountsLoading } = useAccount();
  const isMobile = useIsMobile();
  // 受信箱の未読件数。サイドバーにバッジで出す
  const { data: unreadReplies } = trpc.replies.unreadCount.useQuery(undefined, {
    enabled: hasAccounts, staleTime: 30_000, refetchInterval: 60_000,
  });

  // アカウントが1件も無いと、どの画面もデータを出せない。
  // 追加できる唯一の場所（設定）へ寄せる。
  useEffect(() => {
    if (!accountsLoading && !hasAccounts && location !== "/settings") {
      setLocation("/settings");
    }
  }, [accountsLoading, hasAccounts, location, setLocation]);

  // Navigate and, on mobile, close the sheet sidebar so the page is immediately visible
  function handleNavigate(path: string) {
    setLocation(path);
    if (sidebarIsMobile) setOpenMobile(false);
  }

  useEffect(() => {
    if (isCollapsed) {
      setIsResizing(false);
    }
  }, [isCollapsed]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing) return;

      const sidebarLeft = sidebarRef.current?.getBoundingClientRect().left ?? 0;
      const newWidth = e.clientX - sidebarLeft;
      if (newWidth >= MIN_WIDTH && newWidth <= MAX_WIDTH) {
        setSidebarWidth(newWidth);
      }
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    if (isResizing) {
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    }

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [isResizing, setSidebarWidth]);

  return (
    <>
      <div className="relative" ref={sidebarRef}>
        <Sidebar
          collapsible="icon"
          className="border-r-0"
          disableTransition={isResizing}
        >
          <SidebarHeader className="h-16 justify-center border-b border-sidebar-border">
            <div className="flex items-center gap-3 px-2 transition-all w-full">
              <button
                onClick={toggleSidebar}
                className="h-8 w-8 flex items-center justify-center hover:bg-white/10 rounded-lg transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring shrink-0"
                aria-label="Toggle navigation"
              >
                <PanelLeft className="h-4 w-4 text-white/60" />
              </button>
              {!isCollapsed ? (
                <div className="flex items-center gap-2.5 min-w-0">
                  <BrandMark />
                  <div className="min-w-0 leading-tight">
                    <span className="font-display font-semibold tracking-wide truncate text-sidebar-foreground block text-[15px]">
                      {brandTitle}
                    </span>
                    <span className="text-[10px] tracking-[0.2em] uppercase text-white/40 block">
                      Studio
                    </span>
                  </div>
                </div>
              ) : null}
            </div>
          </SidebarHeader>

          <SidebarContent className="gap-0">
            <AccountSwitcher collapsed={isCollapsed} />
            {!isCollapsed && (
              <p className="px-4 pt-5 pb-1 text-[10px] font-semibold tracking-[0.2em] uppercase text-white/35">
                Menu
              </p>
            )}
            <SidebarMenu className="px-2 py-1">
              {menuItemsV2.map(item => {
                const isActive = location === item.path;
                return (
                  <SidebarMenuItem key={item.path}>
                    <SidebarMenuButton
                      isActive={isActive}
                      onClick={() => handleNavigate(item.path)}
                      tooltip={t(item.label)}
                      className={`h-10 transition-all relative ${isActive ? "bg-white/10 font-medium" : "font-normal hover:bg-white/5"}`}
                    >
                      {isActive && (
                        <span className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-[3px] rounded-full bg-[var(--brand-accent)]" aria-hidden />
                      )}
                      <span className="h-7 w-7 rounded-lg flex items-center justify-center shrink-0">
                        <item.icon className={`h-[18px] w-[18px] ${isActive ? "text-[var(--brand-accent)]" : "text-white/60"}`} strokeWidth={1.8} />
                      </span>
                      <span className={isActive ? "text-white" : "text-white/75"}>{t(item.label)}</span>
                      {item.path === "/inbox" && !!unreadReplies && (
                        <span className="ml-auto min-w-[18px] h-[18px] px-1 rounded-full bg-[var(--brand-accent)] text-[10px] font-bold text-white flex items-center justify-center tabular-nums">
                          {unreadReplies > 99 ? "99+" : unreadReplies}
                        </span>
                      )}
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarContent>

          <SidebarFooter className="p-3 border-t border-sidebar-border">
            {!isCollapsed && (
              <div className="flex justify-end pb-1">
                <LangToggle onDark />
              </div>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex items-center gap-3 rounded-lg px-1.5 py-1.5 hover:bg-white/10 transition-colors w-full text-left group-data-[collapsible=icon]:justify-center focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <Avatar className="h-9 w-9 border border-white/20 shrink-0">
                    <AvatarFallback className="text-xs font-semibold bg-[var(--brand-accent)] text-[#1d3450]">
                      {user?.name?.charAt(0).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0 group-data-[collapsible=icon]:hidden">
                    <p className="text-sm font-medium truncate leading-none text-white">
                      {user?.name || "-"}
                    </p>
                    <p className="text-xs text-white/45 truncate mt-1.5">
                      {user?.email || "-"}
                    </p>
                  </div>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuItem
                  onClick={logout}
                  className="cursor-pointer text-destructive focus:text-destructive"
                >
                  <LogOut className="mr-2 h-4 w-4" />
                  <span>{t("サインアウト")}</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarFooter>
        </Sidebar>
        <div
          className={`absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-primary/20 transition-colors ${isCollapsed ? "hidden" : ""}`}
          onMouseDown={() => {
            if (isCollapsed) return;
            setIsResizing(true);
          }}
          style={{ zIndex: 50 }}
        />
      </div>

      <SidebarInset>
        {isMobile && (
          <div className="flex border-b h-14 items-center justify-between bg-background/95 px-2 backdrop-blur supports-[backdrop-filter]:backdrop-blur sticky top-0 z-40">
            <div className="flex items-center gap-2">
              <SidebarTrigger className="h-9 w-9 rounded-lg bg-background" />
              <div className="flex items-center gap-2.5">
                <BrandMark />
                <span className="font-display font-semibold tracking-tight text-foreground text-[15px]">
                  {activeMenuItem ? t(activeMenuItem.label) : brandTitle}
                </span>
                {currentAccount && (
                  <span className="text-[11px] text-muted-foreground truncate max-w-[40vw]">
                    {currentAccount.name}
                  </span>
                )}
              </div>
            </div>
          </div>
        )}
        <main className="flex-1 p-4 sm:p-8 max-w-5xl w-full mx-auto">{children}</main>
      </SidebarInset>
    </>
  );
}
