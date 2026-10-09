import { Placeholder } from "@/components/Placeholder";
import { McpAccess } from "@/components/settings/McpAccess";
import { Button } from "@/components/ui/button";
import { logout } from "@/app/auth/actions";

export default function SettingsPage() {
  return (
    <Placeholder title="Settings">
      <McpAccess />
      <form action={logout}>
        <Button type="submit" variant="outline">
          Log out
        </Button>
      </form>
    </Placeholder>
  );
}
