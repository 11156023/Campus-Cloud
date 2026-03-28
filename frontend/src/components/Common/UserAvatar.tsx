import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { cn } from "@/lib/utils"
import { getInitials } from "@/utils"

interface UserAvatarProps {
  avatarUrl?: string | null
  className?: string
  email?: string | null
  fallbackClassName?: string
  fullName?: string | null
}

export function UserAvatar({
  avatarUrl,
  className,
  email,
  fallbackClassName,
  fullName,
}: UserAvatarProps) {
  const nameForFallback = fullName || email || "User"

  return (
    <Avatar className={className}>
      {avatarUrl ? (
        <AvatarImage
          src={avatarUrl}
          alt={`${nameForFallback} avatar`}
          className="object-cover object-center"
        />
      ) : null}
      <AvatarFallback
        className={cn("bg-zinc-600 text-white", fallbackClassName)}
      >
        {getInitials(nameForFallback)}
      </AvatarFallback>
    </Avatar>
  )
}

export default UserAvatar
