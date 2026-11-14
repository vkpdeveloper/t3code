import { ArrowLeftIcon, ChartNoAxesColumnIcon, SettingsIcon } from "lucide-react";
import type { ReactNode } from "react";
import { memo } from "react";
import { useAtom, useAtomValue } from "@effect/atom-react";
import { useLocation, useNavigate, useRouter } from "@tanstack/react-router";

import { useEnvironmentIdentificationMode } from "../../hooks/useSettings";
import { cn } from "../../lib/utils";
import { observeResize } from "../../lib/observeResize";
import { usePullRequestsSupported } from "../../state/environments";
import { botListAtom, sidebarModeAtom, unreadBotAtom } from "../../state/bots";
import { isThreadRoutePathname } from "../../threadRoutes";
import { appAtomRegistry } from "../../rpc/atomRegistry";
import { BotAvatar } from "../bots/BotAvatar";
import { BotFaceIcon } from "../bots/BotFaceIcon";
import {
  resolveEnvironmentIdentificationPillLabel,
  useSidebarStageBackdropVariant,
  SidebarStageBackdrop,
  useEnvironmentStageLabel,
} from "../SidebarStageBackdrop";
import { TooltipProvider } from "../ui/tooltip";
import { Badge } from "../ui/badge";
import { T3Wordmark } from "../T3Wordmark";
import {
  SidebarFooter,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarTrigger,
  useSidebar,
} from "../ui/sidebar";
import { PullRequestGlyph } from "../pullRequest/pullRequestIcons";
import { useOpenLayoutPage } from "../../layout/pageNavigation";
import { isSidebarUtilityPage, useNavigateToMainApp } from "./mainAppLocation";
import { SidebarHeaderIconButton } from "./SidebarThreadHeader";
import { SidebarThreadUndoNotice } from "./SidebarThreadUndoNotice";
import { SidebarProviderUpdatePill } from "./SidebarProviderUpdatePill";
import { SidebarUpdateArchitectureWarning, SidebarUpdatePill } from "./SidebarUpdatePill";

// Preserve main's measured minimum even though the redesign omits its wordmark.
export function SidebarBrandWidthProbe({
  isElectron,
  onWidthChange,
}: {
  isElectron: boolean;
  onWidthChange: (width: number) => void;
}) {
  const observeWidth = (probe: HTMLDivElement) =>
    observeResize(probe, ([entry]) => {
      if (entry) onWidthChange(entry.borderBoxSize[0]?.inlineSize ?? probe.offsetWidth);
    });

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none invisible fixed top-0 left-0 flex w-max border-r border-transparent pr-3"
      ref={observeWidth}
    >
      <div className="ml-[var(--workspace-titlebar-content-left)] flex gap-1">
        <span className="inline-flex min-w-0 items-baseline gap-1 text-label tracking-tight">
          <T3Wordmark className="h-[1cap] w-auto shrink-0" />
          <span className="truncate [text-box:trim-both_cap_alphabetic] supports-[text-box:trim-both_cap_alphabetic]:py-1">
            Code
          </span>
        </span>
        {isElectron ? <div className="w-[calc(2*var(--workspace-titlebar-control-size))]" /> : null}
      </div>
    </div>
  );
}

export const SidebarChromeHeader = memo(function SidebarChromeHeader({
  isElectron,
}: {
  isElectron: boolean;
}) {
  const stageLabel = useEnvironmentStageLabel();
  const environmentIdentificationMode = useEnvironmentIdentificationMode();
  const backdropVariant = useSidebarStageBackdropVariant(environmentIdentificationMode);
  const pillLabel =
    environmentIdentificationMode === "pill"
      ? resolveEnvironmentIdentificationPillLabel(stageLabel)
      : null;

  return (
    // The sidebar's share of the window chrome row, not a padded SidebarHeader.
    // On desktop the fixed toggle (and later back/forward) sit over it. In the
    // inset sidebar it spans the edge padding, and the content below starts
    // 4px under the row (pen s8qVFu), so it overlaps the first group's inset.
    <div
      className={cn(
        "@container/sidebar-header relative flex h-(--workspace-chrome-row-height) shrink-0 flex-row items-center gap-2 pr-3 md:px-0",
        "md:group-data-[variant=inset]:-ms-(--workspace-sidebar-edge-inset) md:group-data-[variant=inset]:mb-[calc(--spacing(1)-var(--sidebar-content-inset))]",
        isElectron && "drag-region",
      )}
    >
      {backdropVariant ? <SidebarStageBackdrop variant={backdropVariant} /> : null}
      {/* Match the fixed control's inset inside the sheet's safe area. */}
      <div className="relative top-[calc(var(--workspace-controls-top)-env(safe-area-inset-top))] z-10 ml-[calc(var(--workspace-controls-left)-env(safe-area-inset-left))] flex shrink-0 items-center md:hidden">
        <SidebarTrigger
          variant={backdropVariant ? "media-navigation" : "ghost"}
          className="relative top-auto translate-y-0"
          aria-label="Toggle main sidebar"
        />
      </div>
      {pillLabel ? (
        // Right of the toggle and the two back/forward slots on the chrome row.
        <Badge
          className="relative z-10 ml-1 hidden md:ml-[calc(var(--workspace-controls-left)+var(--workspace-titlebar-control-size)*3+(--spacing(2)))] @[15rem]/sidebar-header:inline-flex"
          data-environment-identification="pill"
          size="sm"
          variant="secondary"
        >
          {pillLabel}
        </Badge>
      ) : null}
    </div>
  );
});

// The footer uses 32px icon-only controls with 16px glyphs (pen C0J52w).
function SidebarUtilityItem({
  icon,
  label,
  isActive = false,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  isActive?: boolean;
  onClick: () => void;
}) {
  return (
    <SidebarHeaderIconButton label={label} size="footer" isActive={isActive} onClick={onClick}>
      {icon}
    </SidebarHeaderIconButton>
  );
}

/** Switches the sidebar between threads and bots; shows a bot's avatar while it has an unread reply. */
function SidebarBotsItem() {
  const [mode, setMode] = useAtom(sidebarModeAtom);
  const unreadBot = useAtomValue(unreadBotAtom);
  const navigate = useNavigate();
  const router = useRouter();
  const { isMobile, setOpenMobile } = useSidebar();
  const showingBots = mode === "bots";
  const toggle = () => {
    const { pathname } = router.state.location;
    if (showingBots) {
      setMode("threads");
      const bots = appAtomRegistry.get(botListAtom);
      const onBotPage =
        pathname === "/bots" || bots.some((bot) => isThreadRoutePathname(pathname, bot.threadRef));
      if (onBotPage) void navigate({ to: "/" });
      return;
    }
    setMode("bots");
    // With no bots the create form is the whole page, so the sheet would only cover it.
    if (isMobile && appAtomRegistry.get(botListAtom).length === 0) setOpenMobile(false);
    void navigate({ to: "/bots" });
  };
  return (
    <SidebarUtilityItem
      icon={
        unreadBot && !showingBots ? (
          <BotAvatar avatar={unreadBot.avatar} threadRef={unreadBot.threadRef} className="size-4" />
        ) : (
          <BotFaceIcon />
        )
      }
      label={showingBots ? "Threads" : unreadBot ? `Bots, ${unreadBot.name} replied` : "Bots"}
      isActive={showingBots}
      onClick={toggle}
    />
  );
}

const SidebarUtilityMenu = memo(function SidebarUtilityMenu() {
  const navigate = useNavigate();
  const navigateToMainApp = useNavigateToMainApp();
  const openLayoutPage = useOpenLayoutPage();
  const { isMobile, setOpenMobile } = useSidebar();
  const isOnUtilityPage = useLocation({
    select: (location) => isSidebarUtilityPage(location.pathname),
  });
  const pullRequestsSupported = usePullRequestsSupported();
  const closeMobileSidebar = () => {
    if (isMobile) {
      setOpenMobile(false);
    }
  };
  const handlePullRequestsClick = () => {
    closeMobileSidebar();
    void openLayoutPage("pull-requests");
  };
  const handleSettingsClick = () => {
    closeMobileSidebar();
    void navigate({ to: "/settings", search: { pane: undefined } });
  };

  const handleUsageClick = () => {
    if (isMobile) {
      setOpenMobile(false);
    }
    void navigate({ to: "/usage" });
  };

  const handleBackClick = () => {
    closeMobileSidebar();
    void navigateToMainApp();
  };

  return (
    <TooltipProvider>
      <SidebarMenu className="flex-row items-center">
        {isOnUtilityPage ? (
          <SidebarMenuItem className="min-w-0 flex-1">
            <SidebarMenuButton size="control" onClick={handleBackClick}>
              <ArrowLeftIcon />
              <span>Back</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        ) : (
          // Keep the utilities in the design's compact, icon-only row.
          <SidebarMenuItem className="shrink-0">
            <div className="flex gap-1">
              <SidebarUtilityItem
                icon={<SettingsIcon className="size-4" />}
                label="Settings"
                onClick={handleSettingsClick}
              />
              {pullRequestsSupported ? (
                <SidebarUtilityItem
                  icon={<PullRequestGlyph.pullRequest className="size-4" />}
                  label="Pull Requests"
                  onClick={handlePullRequestsClick}
                />
              ) : null}
              <SidebarUtilityItem
                icon={<ChartNoAxesColumnIcon className="size-4" />}
                label="Usage"
                onClick={handleUsageClick}
              />
              <SidebarBotsItem />
            </div>
          </SidebarMenuItem>
        )}
        <SidebarThreadUndoNotice />
        <SidebarUpdatePill />
      </SidebarMenu>
    </TooltipProvider>
  );
});

export const SidebarChromeFooter = memo(function SidebarChromeFooter() {
  return (
    <SidebarFooter>
      <SidebarProviderUpdatePill />
      <SidebarUpdateArchitectureWarning />
      <SidebarUtilityMenu />
    </SidebarFooter>
  );
});
