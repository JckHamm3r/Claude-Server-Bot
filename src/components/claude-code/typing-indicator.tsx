"use client";

import { motion, AnimatePresence } from "framer-motion";
import { User } from "lucide-react";

interface TypingUser {
  email: string;
  firstName: string;
  lastName: string;
  avatarUrl: string | null;
}

interface TypingIndicatorProps {
  typingUsers: TypingUser[];
}

export function TypingIndicator({ typingUsers }: TypingIndicatorProps) {
  if (typingUsers.length === 0) return null;

  const displayUsers = typingUsers.slice(0, 3);
  const overflowCount = typingUsers.length - 3;

  const getDisplayName = (user: TypingUser) => {
    const firstName = user.firstName?.trim();
    const lastName = user.lastName?.trim();
    if (firstName && lastName) return `${firstName} ${lastName}`;
    if (firstName) return firstName;
    if (lastName) return lastName;
    return user.email.split("@")[0];
  };

  const names = typingUsers.map(getDisplayName);
  const displayText =
    names.length === 1
      ? `${names[0]} is typing...`
      : names.length === 2
        ? `${names[0]} and ${names[1]} are typing...`
        : `${names[0]}, ${names[1]}, and ${names.length - 2} ${names.length - 2 === 1 ? "other" : "others"} are typing...`;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 10 }}
        transition={{ duration: 0.2 }}
        className="flex items-center gap-2 px-4 py-2 mb-2"
      >
        <div className="flex items-center -space-x-2">
          {displayUsers.map((user, idx) => (
            <motion.div
              key={user.email}
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0, opacity: 0 }}
              transition={{ delay: idx * 0.05 }}
              className="relative"
              title={getDisplayName(user)}
            >
              <div className="relative h-6 w-6 rounded-full border-2 border-bot-bg bg-bot-surface overflow-hidden shadow-sm">
                {user.avatarUrl ? (
                  <img
                    src={user.avatarUrl}
                    alt={getDisplayName(user)}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center bg-bot-accent/10">
                    <User className="h-3 w-3 text-bot-accent" />
                  </div>
                )}
                <motion.div
                  className="absolute inset-0 rounded-full bg-bot-accent/20"
                  animate={{
                    opacity: [0.3, 0.6, 0.3],
                  }}
                  transition={{
                    duration: 1.5,
                    repeat: Infinity,
                    ease: "easeInOut",
                  }}
                />
              </div>
            </motion.div>
          ))}
          {overflowCount > 0 && (
            <motion.div
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="relative z-10 flex h-6 w-6 items-center justify-center rounded-full border-2 border-bot-bg bg-bot-muted/30 text-caption font-medium text-bot-text"
              title={`${overflowCount} more`}
            >
              +{overflowCount}
            </motion.div>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          <span className="text-caption text-bot-muted">{displayText}</span>
          <div className="flex items-center gap-0.5">
            {[0, 1, 2].map((i) => (
              <motion.div
                key={i}
                className="h-1 w-1 rounded-full bg-bot-muted"
                animate={{
                  opacity: [0.3, 1, 0.3],
                  scale: [0.8, 1, 0.8],
                }}
                transition={{
                  duration: 1,
                  repeat: Infinity,
                  delay: i * 0.2,
                  ease: "easeInOut",
                }}
              />
            ))}
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
