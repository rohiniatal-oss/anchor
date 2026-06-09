import { Sun } from "lucide-react";

export function Empty({ icon: Icon, text }: { icon: typeof Sun; text: string }) {
  return (
    <div className="text-center py-12 text-muted-foreground">
      <Icon className="w-8 h-8 mx-auto mb-3 opacity-40" />
      <p className="text-sm">{text}</p>
    </div>
  );
}
