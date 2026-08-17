/**
 * AIscentra — vfinal admin access-denied state (Frontend Design
 * Foundation, layer 6). Real /auth/signout form action unchanged --
 * only visual language migrated.
 */
export function VfinalAdminAccessDenied({ userEmail }: { userEmail: string }): React.JSX.Element {
  return (
    <div className="flex min-h-screen items-center justify-center bg-deep-obsidian px-6 text-frost">
      <div className="text-center">
        <span className="font-caption mb-2 block text-silver-haze">ACCESS DENIED</span>
        <p className="text-silver-haze">{userEmail} is not an Observatory administrator.</p>
        <form action="/auth/signout" method="post" className="mt-4">
          <button
            type="submit"
            className="font-caption text-silver-haze transition-colors hover:text-mint-signal"
          >
            SIGN OUT
          </button>
        </form>
      </div>
    </div>
  )
}
