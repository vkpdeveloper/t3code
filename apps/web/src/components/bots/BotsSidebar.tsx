import type { BotSummary } from "@t3tools/client-runtime/state/bots";
import { useAtomValue } from "@effect/atom-react";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { PlusIcon } from "lucide-react";
import { memo, useState } from "react";

import { isElectron } from "../../env";
import { cn } from "../../lib/utils";
import { botListAtom } from "../../state/bots";
import { buildThreadRouteParams, isThreadRoutePathname } from "../../threadRoutes";
import { SidebarChromeFooter, SidebarChromeHeader } from "../sidebar/SidebarChrome";
import { Button } from "../ui/button";
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
          "flex w-full cursor-pointer items-center gap-3 rounded-lg px-2 py-2 text-left outline-hidden ring-ring hover:bg-sidebar-row-hover focus-visible:ring-2 focus-visible:ring-inset",
          active && "bg-sidebar-row-hover",
        )}
      >
        <BotAvatar avatar={bot.avatar} threadRef={bot.threadRef} className="size-9" />
        <span className="flex min-w-0 flex-1 flex-col">
          <span
            className={cn(
              "truncate text-sm text-sidebar-foreground",
              bot.unread ? "font-semibold" : "font-medium",
            )}
          >
            {bot.name}
          </span>
          <span className="truncate text-xs text-sidebar-muted-foreground">
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

  const openBot = (bot: BotSummary) => {
    if (isMobile) setOpenMobile(false);
    void navigate({
      to: "/$environmentId/$threadId",
      params: buildThreadRouteParams(bot.threadRef),
    });
  };

  return (
    <>
      <SidebarChromeHeader isElectron={isElectron} />
      <SidebarContent
        className="min-h-full"
        fixedHeader={
          <SidebarGroup className="flex-row items-center justify-between">
            <span className="px-2 text-sm font-medium text-sidebar-foreground">Bots</span>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="New bot"
              onClick={() => setCreating(true)}
            >
              <PlusIcon />
            </Button>
          </SidebarGroup>
        }
      >
        <SidebarGroup>
          {bots.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-2 py-6 text-center text-xs text-muted-foreground/60">
              <span>No bots yet</span>
              <Button size="compact" variant="outline" onClick={() => setCreating(true)}>
                <PlusIcon />
                New bot
              </Button>
            </div>
          ) : (
            <ul className="flex flex-col gap-0.5">
              {bots.map((bot) => (
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
