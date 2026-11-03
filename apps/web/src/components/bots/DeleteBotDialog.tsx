import { useId, useState } from "react";

import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";

/** Deleting a bot ends its chat for good, so the user types its name to confirm. */
export function DeleteBotDialog({
  name,
  open,
  onOpenChange,
  onDelete,
}: {
  name: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDelete: () => Promise<void>;
}) {
  const id = useId();
  const [typed, setTyped] = useState("");
  const [deleting, setDeleting] = useState(false);
  const matches = typed.trim() === name;
  const confirm = async () => {
    if (!matches || deleting) return;
    setDeleting(true);
    await onDelete();
    setDeleting(false);
  };
  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setTyped("");
        onOpenChange(next);
      }}
    >
      <AlertDialogPopup>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {name}?</AlertDialogTitle>
          <AlertDialogDescription>
            Its chat and routines stop for good. Files in its folder stay on disk.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <form
          className="flex flex-col gap-1.5 px-6 pb-2"
          onSubmit={(event) => {
            event.preventDefault();
            void confirm();
          }}
        >
          <Label htmlFor={`${id}-name`}>
            <span>
              Type <span className="text-label text-foreground">{name}</span> to confirm
            </span>
          </Label>
          <Input
            id={`${id}-name`}
            autoFocus
            autoComplete="off"
            spellCheck={false}
            value={typed}
            disabled={deleting}
            onChange={(event) => setTyped(event.target.value)}
          />
        </form>
        <AlertDialogFooter>
          <AlertDialogClose render={<Button variant="secondary" />}>Cancel</AlertDialogClose>
          <Button variant="destructive" disabled={!matches || deleting} onClick={confirm}>
            {deleting ? "Deleting" : "Delete bot"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogPopup>
    </AlertDialog>
  );
}
