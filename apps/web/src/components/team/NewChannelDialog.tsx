import { HashIcon, PlusIcon } from "lucide-react";
import { useId, useMemo, useState } from "react";

import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { channelSlugError, deriveChannelSlug } from "./channelSlug";
import type { DeclareChannelInput } from "./useChannelsData";

type NewChannelDialogProps = {
  existingSlugs: readonly string[];
  onDeclare: (input: DeclareChannelInput) => void;
};

/**
 * Declare a channel from the Team space so the surface works without hand-seeding
 * `.repokin/channels/`. The slug auto-derives from the name until the user edits
 * it, and dispatches `team.channel.declare` through the channels seam.
 */
export function NewChannelDialog({ existingSlugs, onDeclare }: NewChannelDialogProps) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const [description, setDescription] = useState("");
  const formId = useId();

  const effectiveSlug = slugEdited ? slug : deriveChannelSlug(name);
  const slugError = useMemo(() => {
    const formatError = channelSlugError(effectiveSlug);
    if (formatError !== null) return formatError;
    return existingSlugs.includes(effectiveSlug) ? "A channel with this id already exists." : null;
  }, [effectiveSlug, existingSlugs]);
  const canSubmit = name.trim().length > 0 && slugError === null;

  const reset = () => {
    setName("");
    setSlug("");
    setSlugEdited(false);
    setDescription("");
  };

  const submit = () => {
    if (!canSubmit) return;
    onDeclare({ slug: effectiveSlug, name, description });
    setOpen(false);
  };

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <PlusIcon className="size-4" />
        New channel
      </Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        onOpenChangeComplete={(next) => {
          if (!next) reset();
        }}
      >
        <DialogPopup>
          <DialogHeader>
            <DialogTitle>New channel</DialogTitle>
            <DialogDescription>
              Channels are roster-scoped. The declaration is written under{" "}
              <code>.repokin/channels/</code>.
            </DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <form
              id={formId}
              className="space-y-4"
              onSubmit={(event) => {
                event.preventDefault();
                submit();
              }}
            >
              <div className="space-y-1.5">
                <Label htmlFor={`${formId}-name`}>Name</Label>
                <Input
                  id={`${formId}-name`}
                  autoFocus
                  placeholder="Team"
                  value={name}
                  onChange={(event) => setName(event.currentTarget.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`${formId}-slug`}>Channel id</Label>
                <div className="flex items-center gap-2">
                  <HashIcon className="size-4 shrink-0 text-muted-foreground" />
                  <Input
                    id={`${formId}-slug`}
                    placeholder="team"
                    value={effectiveSlug}
                    onChange={(event) => {
                      setSlug(event.currentTarget.value);
                      setSlugEdited(true);
                    }}
                    aria-invalid={slugError !== null}
                    className="flex-1"
                  />
                </div>
                {slugError !== null ? (
                  <p className="text-xs text-destructive">{slugError}</p>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    The file stem under <code>.repokin/channels/</code>.
                  </p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`${formId}-description`}>Description (optional)</Label>
                <Input
                  id={`${formId}-description`}
                  placeholder="What this channel is for"
                  value={description}
                  onChange={(event) => setDescription(event.currentTarget.value)}
                />
              </div>
            </form>
          </DialogPanel>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button form={formId} type="submit" disabled={!canSubmit}>
              Create channel
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
    </>
  );
}
