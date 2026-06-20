import React, { useEffect, useState } from "react";
import type { Profile } from "~/stores/apiStore";

type ProfileSelectorProps = {
  className?: string;
  size?: "sm" | "md" | "lg"; 
  onChange?: (profileId: string) => void;
}

/**
 * A dropdown component for selecting and switching between profiles
 */
const ProfileSelector: React.FC<ProfileSelectorProps> = ({ 
  className = "",
  size = "md",
  onChange
}) => {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [currentProfileId, setCurrentProfileId] = useState<string>("");
  const [isLoading, setIsLoading] = useState(true);

  // Size-based styles
  const sizeStyles = {
    sm: "text-xs py-1 px-2",
    md: "text-sm py-1.5 px-3",
    lg: "text-base py-2 px-4"
  };

  const fetchProfiles = async () => {
    try {
      setIsLoading(true);
      const result = await window.electronAPI.getProfiles();

      if (result.profiles) {
        setProfiles(result.profiles);
        setCurrentProfileId(result.currentProfileId || "");
      }
    } catch (err) {
      console.error("Failed to fetch profiles:", err);
    } finally {
      setIsLoading(false);
    }
  };

  // Fetch profiles on component mount
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchProfiles();

    // Set up listener for profile updates
    const cleanup = window.electronAPI.onProfileUpdated?.(() => {
      fetchProfiles();
    });

    return () => {
      cleanup?.();
    };
  }, []);

  const handleChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newProfileId = e.target.value;
    try {
      const result = await window.electronAPI.applyProfile({ profileId: newProfileId });
      
      if (result.success) {
        setCurrentProfileId(newProfileId);
        onChange?.(newProfileId);
      } else {
        console.error("Failed to apply profile:", result.error);
      }
    } catch (err) {
      console.error("Error applying profile:", err);
    }
  };

  if (profiles.length <= 1) {
    return null; // Don't show selector if there's only one profile
  }

  return (
    <div className={`${className} flex items-center gap-2`}>
      <label htmlFor="profile-selector" className="text-label-primary flex items-center gap-1.5">
        <span className="hidden sm:inline">Profile:</span>
        {isLoading && (
          <span className="size-3.5 border-t-2 border-r-2 border-accent rounded-full animate-spin"></span>
        )}
      </label>
      <select
        id="profile-selector"
        value={currentProfileId}
        onChange={handleChange}
        disabled={isLoading}
        className={`${sizeStyles[size]} bg-control border border-separator/60 rounded text-label-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50`}
        aria-label="Select profile"
      >
        {profiles.map((profile) => (
          <option key={profile.id} value={profile.id}>
            {profile.name}
          </option>
        ))}
      </select>
    </div>
  );
};

export default ProfileSelector;
