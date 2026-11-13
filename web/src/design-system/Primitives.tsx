import { type ReactNode, useState } from "react";
import { toast } from "sonner";
import { RISK_STATUS, VERDICT_STATUS } from "../lib/status.ts";
import { Badge } from "../ui/badge.tsx";
import { Button } from "../ui/button.tsx";
import { Checkbox } from "../ui/checkbox.tsx";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../ui/collapsible.tsx";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "../ui/context-menu.tsx";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "../ui/dialog.tsx";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu.tsx";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "../ui/hover-card.tsx";
import { Input } from "../ui/input.tsx";
import { Kbd, KbdGroup } from "../ui/kbd.tsx";
import { Label } from "../ui/label.tsx";
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "../ui/popover.tsx";
import { RadioGroup, RadioGroupItem } from "../ui/radio-group.tsx";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "../ui/resizable.tsx";
import { ScrollArea } from "../ui/scroll-area.tsx";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select.tsx";
import { Separator } from "../ui/separator.tsx";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "../ui/sheet.tsx";
import { Skeleton } from "../ui/skeleton.tsx";
import { StatusBadge } from "../ui/status-badge.tsx";
import { Switch } from "../ui/switch.tsx";
import { Tabs, TabsContent, TabsCount, TabsList, TabsTrigger } from "../ui/tabs.tsx";
import { Textarea } from "../ui/textarea.tsx";
import { ToggleGroup, ToggleGroupItem } from "../ui/toggle-group.tsx";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip.tsx";

const RISK_ITEMS = Object.entries(RISK_STATUS).map(([value, { label }]) => ({ value, label }));
const VARIANTS = ["default", "secondary", "outline", "ghost", "destructive", "link"] as const;
const SIZES = ["xs", "sm", "default", "lg"] as const;
const FILES = Array.from(
  { length: 30 },
  (_, index) => `web/src/pages/review/file-${index + 1}.tsx`,
);

/** Every shadcn primitive, restyled to Indigo Calm, in the states it has. */
export const Primitives = () => (
  <div className="flex flex-col gap-8">
    <Group title="Button">
      {VARIANTS.map((variant) => (
        <Row key={variant} label={variant}>
          {SIZES.map((size) => (
            <Button key={size} variant={variant} size={size}>
              {size}
            </Button>
          ))}
          <Button variant={variant} disabled>
            disabled
          </Button>
        </Row>
      ))}
      <Row label="icon">
        <Button variant="ghost" size="icon-xs" aria-label="Expand">
          <span aria-hidden="true">↕</span>
        </Button>
        <Button variant="outline" size="icon-sm" aria-label="Expand">
          <span aria-hidden="true">↕</span>
        </Button>
      </Row>
    </Group>

    <Group title="Badge and StatusBadge">
      <Row label="verdict">
        {Object.entries(VERDICT_STATUS).map(([verdict, status]) => (
          <StatusBadge key={verdict} status={status} />
        ))}
      </Row>
      <Row label="risk">
        {Object.entries(RISK_STATUS).map(([risk, status]) => (
          <StatusBadge key={risk} status={status} />
        ))}
      </Row>
      <Row label="badge">
        <Badge>default</Badge>
        <Badge variant="secondary">secondary</Badge>
        <Badge variant="outline">outline</Badge>
        <Badge variant="destructive">destructive</Badge>
      </Row>
    </Group>

    <Group title="Tabs">
      <Tabs defaultValue="files">
        <TabsList>
          <TabsTrigger value="map">Map</TabsTrigger>
          <TabsTrigger value="files">Files</TabsTrigger>
          <TabsTrigger value="overview" disabled>
            Overview
          </TabsTrigger>
        </TabsList>
      </Tabs>
      <Tabs defaultValue="files">
        <TabsList variant="underline">
          <TabsTrigger value="conversation">
            Intent <TabsCount>2</TabsCount>
          </TabsTrigger>
          <TabsTrigger value="files">
            Files <TabsCount>21</TabsCount>
          </TabsTrigger>
          <TabsTrigger value="decisions">
            Decisions <TabsCount>7</TabsCount>
          </TabsTrigger>
        </TabsList>
        <TabsContent value="files" className="pt-2 text-muted-foreground">
          The files tab's panel.
        </TabsContent>
      </Tabs>
    </Group>

    <Group title="Tooltip and Kbd">
      <Row label="tooltip">
        <Tooltip>
          <TooltipTrigger render={<Button variant="outline" size="sm" />}>Next file</TooltipTrigger>
          <TooltipContent shortcut="n">Next file</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger render={<Button variant="outline" size="sm" />}>No key</TooltipTrigger>
          <TooltipContent>A tooltip without a shortcut</TooltipContent>
        </Tooltip>
      </Row>
      <Row label="kbd">
        <Kbd>n</Kbd>
        <Kbd>?</Kbd>
        <KbdGroup>
          <Kbd>⌘</Kbd>
          <Kbd>↵</Kbd>
        </KbdGroup>
      </Row>
    </Group>

    <Group title="Toggle group">
      <ToggleGroup size="sm" variant="outline" defaultValue={["map"]}>
        <ToggleGroupItem value="map">Map</ToggleGroupItem>
        <ToggleGroupItem value="overview">Overview</ToggleGroupItem>
      </ToggleGroup>
      <ToggleGroup size="sm" defaultValue={["tree"]}>
        <ToggleGroupItem value="tree">Tree</ToggleGroupItem>
        <ToggleGroupItem value="overview">Overview</ToggleGroupItem>
      </ToggleGroup>
    </Group>

    <Group title="Form controls">
      <div className="grid max-w-md gap-3">
        <Field label="Input" id="ds-input">
          <Input id="ds-input" placeholder="Filter files" />
        </Field>
        <Field label="Disabled" id="ds-input-disabled">
          <Input id="ds-input-disabled" disabled value="read only" />
        </Field>
        <Field label="Invalid" id="ds-input-invalid">
          <Input id="ds-input-invalid" aria-invalid defaultValue="not a PR URL" />
        </Field>
        <Composer />
      </div>
      <Row label="checkbox">
        <Label>
          <Checkbox defaultChecked /> Checked
        </Label>
        <Label>
          <Checkbox /> Unchecked
        </Label>
        <Label>
          <Checkbox disabled /> Disabled
        </Label>
      </Row>
      <RadioGroup defaultValue="approve" className="flex gap-4">
        <Label>
          <RadioGroupItem value="approve" /> Approve
        </Label>
        <Label>
          <RadioGroupItem value="request" /> Request changes
        </Label>
      </RadioGroup>
      <Row label="select">
        <Select defaultValue="contract" items={RISK_ITEMS}>
          <SelectTrigger className="w-40" aria-label="Risk">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="contract">Contract</SelectItem>
            <SelectItem value="logic">Logic</SelectItem>
            <SelectItem value="mechanical">Mechanical</SelectItem>
          </SelectContent>
        </Select>
      </Row>
      <Row label="switch">
        <Label>
          <Switch defaultChecked /> Color-blind diff
        </Label>
        <Label>
          <Switch disabled /> Disabled
        </Label>
      </Row>
    </Group>

    <Group title="Overlays">
      <Row label="open">
        <Dialog>
          <DialogTrigger render={<Button variant="outline" />}>Dialog</DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Publish review</DialogTitle>
              <DialogDescription>
                Posts 2 comments and requests changes on the pull request.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
              <Button>Publish</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        <Sheet>
          <SheetTrigger render={<Button variant="outline" />}>Sheet</SheetTrigger>
          <SheetContent>
            <SheetHeader>
              <SheetTitle>Files</SheetTitle>
              <SheetDescription>The tree, behind a button at 1024px or less.</SheetDescription>
            </SheetHeader>
          </SheetContent>
        </Sheet>
        <Popover>
          <PopoverTrigger render={<Button variant="outline" />}>Popover</PopoverTrigger>
          <PopoverContent>
            <PopoverTitle>Details</PopoverTitle>
            <p className="text-muted-foreground">Popovers are rounded-xl with shadow-md.</p>
          </PopoverContent>
        </Popover>
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="outline" />}>Menu</DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem>Open on GitHub</DropdownMenuItem>
            <DropdownMenuCheckboxItem checked>Show mechanical</DropdownMenuCheckboxItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive">Discard drafts</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <HoverCard>
          <HoverCardTrigger render={<Button variant="link" />}>Hover card</HoverCardTrigger>
          <HoverCardContent>Shown on hover and focus.</HoverCardContent>
        </HoverCard>
        <Button variant="outline" onClick={() => toast.success("Review published")}>
          Toast
        </Button>
      </Row>
      <ContextMenu>
        <ContextMenuTrigger className="flex h-16 items-center justify-center rounded-lg border border-dashed text-muted-foreground">
          Right-click here
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem>Copy path</ContextMenuItem>
          <ContextMenuItem>Copy line link</ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    </Group>

    <Group title="Layout">
      <ResizablePanelGroup className="h-40 rounded-lg border" orientation="horizontal">
        <ResizablePanel defaultSize="30%">
          <ScrollArea className="h-full">
            <ul className="p-2 font-mono text-code-compact">
              {FILES.map((file) => (
                <li key={file} className="truncate">
                  {file}
                </li>
              ))}
            </ul>
          </ScrollArea>
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel className="p-3 text-muted-foreground">
          Resizable: the tree beside the code.
        </ResizablePanel>
      </ResizablePanelGroup>
      <Separator />
      <Collapsible>
        <CollapsibleTrigger render={<Button variant="ghost" size="sm" />}>
          package-lock.json: generated, 412 lines
        </CollapsibleTrigger>
        <CollapsibleContent className="px-3 py-2 font-mono text-code text-muted-foreground">
          The collapsed hunk's lines.
        </CollapsibleContent>
      </Collapsible>
      <div className="flex flex-col gap-2">
        <Skeleton className="h-4 w-64" />
        <Skeleton className="h-4 w-48" />
      </div>
    </Group>
  </div>
);

const Composer = () => {
  const [sent, setSent] = useState<string | null>(null);
  const [text, setText] = useState("");
  return (
    <Field label="Comment (⌘↵ submits)" id="ds-composer">
      <Textarea
        id="ds-composer"
        value={text}
        onChange={(event) => setText(event.target.value)}
        onSubmitShortcut={() => {
          setSent(text);
          setText("");
        }}
        placeholder="Leave a comment"
      />
      {sent !== null && <p className="text-caption text-muted-foreground">Sent: {sent}</p>}
    </Field>
  );
};

const Group = ({ title, children }: { readonly title: string; readonly children: ReactNode }) => (
  <section className="flex flex-col gap-3">
    <h3 className="text-heading font-semibold">{title}</h3>
    {children}
  </section>
);

const Row = ({ label, children }: { readonly label: string; readonly children: ReactNode }) => (
  <div className="flex flex-wrap items-center gap-2">
    <span className="w-24 text-caption text-muted-foreground">{label}</span>
    {children}
  </div>
);

const Field = ({
  label,
  id,
  children,
}: {
  readonly label: string;
  readonly id: string;
  readonly children: ReactNode;
}) => (
  <div className="flex flex-col gap-1.5">
    <Label htmlFor={id}>{label}</Label>
    {children}
  </div>
);
