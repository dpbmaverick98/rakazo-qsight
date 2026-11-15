import { useLingui } from "@lingui/react/macro";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@rakazo/ui-web";
import { Plus } from "lucide-react";
import type { RefObject } from "react";
import { useRef } from "react";
import { attachmentPickerAccept } from "../../lib/attachment-picker-accept";

export function ComposerAttachmentPicker({
  fileInputRef,
  attachButtonRef,
  disabled,
  expanded,
  onPick,
}: {
  fileInputRef: RefObject<HTMLInputElement | null>;
  attachButtonRef: RefObject<HTMLButtonElement | null>;
  disabled?: boolean;
  expanded: boolean;
  onPick: (files: FileList | null) => void;
}) {
  const { t } = useLingui();
  const folderInputRef = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept={attachmentPickerAccept(navigator.userAgent)}
        className="hidden"
        onChange={(event) => onPick(event.target.files)}
      />
      <input
        ref={folderInputRef}
        type="file"
        multiple
        {...{ webkitdirectory: "" }}
        className="hidden"
        aria-label={t`Attach folder`}
        onChange={(event) => {
          onPick(event.target.files);
          event.target.value = "";
        }}
      />
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              ref={attachButtonRef}
              variant="ghost"
              size="icon"
              aria-label={t`Attach file`}
              disabled={disabled}
              className={`col-start-1 size-8 shrink-0 rounded-full border border-border bg-muted text-muted-foreground transition-colors hover:bg-accent hover:text-foreground ${
                expanded ? "row-start-2" : ""
              }`}
            />
          }
        >
          <Plus size={16} strokeWidth={2} />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem
            onClick={() => fileInputRef.current?.click()}
          >{t`Attach files`}</DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => folderInputRef.current?.click()}
          >{t`Attach folder`}</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
