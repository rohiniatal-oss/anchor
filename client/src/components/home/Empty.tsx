import { Sun } from "lucide-react";

export function Empty({ icon: Icon, text, action }: { icon: typeof Sun; text: string; action?: { label: string; onClick: () => void } }) {
  return (
    <div className="text-center py-12 text-muted-foreground">
      <Icon className="w-8 h-8 mx-auto mb-3 opacity-40" />
      <p className="text-sm">{text}</p>
      {action && (
        <button onClick={action.onClick} className="mt-3 text-sm text-primary font-medium hover:underline">
          {action.label}
        </button>
      )}
    </div>
  );
}
