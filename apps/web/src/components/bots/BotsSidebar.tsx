import type { BotSummary } from "@t3tools/client-runtime/state/bots";
import { useAtomValue } from "@effect/atom-react";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { PlusIcon, SearchIcon } from "lucide-react";
import { memo, useState } from "react";

import { isElectron } from "../../env";
import { cn } from "../../lib/utils";
import { botListAtom } from "../../state/bots";
import { buildThreadRouteParams, isThreadRoutePathname } from "../../threadRoutes";
import { SidebarChromeFooter, SidebarChromeHeader } from "../sidebar/SidebarChrome";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { SidebarContent, SidebarGroup, useSidebar } from "../ui/sidebar";
import { BotAvatar } from "./BotAvatar";
import { CreateBotDialog } from "./CreateBotDialog";

const BotRow = memo(function BotRow({
  bot,
  active,
  onOpen,
}: {
  bot: BotSummary;
  active: boolean;
  onOpen: (bot: BotSummary) => void;
}) {
  return (
    <li className="list-none">
      <button
        type="button"
        aria-current={active ? "page" : undefined}
        onClick={() => onOpen(bot)}
        className={cn(
          "group/bot flex w-full cursor-pointer items-center gap-3 rounded-xl px-2.5 py-2.5 text-left outline-hidden ring-ring hover:bg-sidebar-row-hover focus-visible:ring-2 focus-visible:ring-inset",
          active && "bg-sidebar-row-hover",
        )}
      >
        <BotAvatar avatar={bot.avatar} threadRef={bot.threadRef} className="size-10" />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span
            className={cn(
              "truncate text-base leading-5 text-sidebar-foreground",
              bot.unread ? "font-semibold" : "font-medium",
            )}
          >
            {bot.name}
          </span>
          <span
            className={cn(
              "truncate text-sm leading-5",
              bot.unread ? "text-sidebar-foreground" : "text-sidebar-muted-foreground",
            )}
          >
            {bot.working ? "Working" : (bot.preview ?? "No messages yet")}
          </span>
        </span>
        {bot.unread ? (
          <span aria-label="Unread" className="size-2 shrink-0 rounded-full bg-primary" />
        ) : null}
      </button>
    </li>
  );
});

export default function BotsSidebar() {
  const bots = useAtomValue(botListAtom);
  const navigate = useNavigate();
  const pathname = useLocation({ select: (location) => location.pathname });
  const { isMobile, setOpenMobile } = useSidebar();
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState<string | null>(null);
  const needle = query?.trim().toLowerCase() ?? "";
  const visibleBots =
    needle.length === 0 ? bots : bots.filter((bot) => bot.name.toLowerCase().includes(needle));

  const openBot = (bot: BotSummary) => {
    if (isMobile) setOpenMobile(false);
    void navigate({
      to: "/$environmentId/$threadId",
      params: buildThreadRouteParams(bot.threadRef),
    });
  };

  const newBotButton = (
    <Button
      size="icon-lg"
      variant={isMobile ? "ghost" : "glass"}
      aria-label="New bot"
      onClick={() => setCreating(true)}
    >
      <PlusIcon />
    </Button>
  );
  // On phones the chat header's controls float over the sheet's top row, so actions sit below it.
  const searchRow =
    isMobile || query !== null ? (
      <SidebarGroup>
        <div className="flex items-center gap-1">
          <Input
            autoFocus={!isMobile}
            type="search"
            aria-label="Search bots"
            placeholder="Search"
            value={query ?? ""}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") setQuery(null);
            }}
          />
          {isMobile ? newBotButton : null}
        </div>
      </SidebarGroup>
    ) : null;

  return (
    <>
      <SidebarChromeHeader
        isElectron={isElectron}
        actions={
          isMobile ? null : (
            <>
              <Button
                size="icon-lg"
                variant="glass"
                aria-label="Search bots"
                aria-pressed={query !== null}
                onClick={() => setQuery((current) => (current === null ? "" : null))}
              >
                <SearchIcon />
              </Button>
              {newBotButton}
            </>
          )
        }
      />
      <SidebarContent className="min-h-full" fixedHeader={searchRow}>
        <SidebarGroup>
          {visibleBots.length === 0 ? (
            <p className="px-2 py-6 text-center text-xs text-muted-foreground/60">
              {bots.length === 0 ? "No bots yet" : "No matching bots"}
            </p>
          ) : (
            <ul className="flex flex-col gap-0.5">
              {visibleBots.map((bot) => (
                <BotRow
                  key={bot.key}
                  bot={bot}
                  active={isThreadRoutePathname(pathname, bot.threadRef)}
                  onOpen={openBot}
                />
              ))}
            </ul>
          )}
        </SidebarGroup>
      </SidebarContent>
      <SidebarChromeFooter />
      <CreateBotDialog open={creating} onOpenChange={setCreating} />
    </>
  );
}
