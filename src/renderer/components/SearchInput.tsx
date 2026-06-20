import React, { useState, useEffect, useRef, useCallback } from "react";

type SearchInputProps = {
  onSearch: (value: string) => void;
  placeholder?: string;
  debounceMs?: number;
  className?: string;
  suggestions?: string[];
  dataListId?: string;
};

/**
 * A reusable search input component with debounce functionality
 */
export const SearchInput: React.FC<SearchInputProps> = ({
  onSearch,
  placeholder = "Search...",
  debounceMs = 300,
  className = "",
  suggestions = [],
  dataListId = "search-suggestions",
}) => {
  const [inputValue, setInputValue] = useState("");
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const debouncedSearch = useCallback(
    (value: string) => {
      // Clear any existing timer
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }

      // Set a new timer
      timerRef.current = setTimeout(() => {
        onSearch(value);
      }, debounceMs);
    },
    [onSearch, debounceMs]
  );

  // Handle input change with debounce
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setInputValue(value);
    debouncedSearch(value);
  };

  // Clean up timer on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);

  return (
    <div className={`relative ${className}`}>
      <input
        type="text"
        value={inputValue}
        onChange={handleChange}
        placeholder={placeholder}
        className="w-full bg-control border border-separator/60 text-label-primary px-8 py-1.5 rounded-[6px] text-[0.846rem] focus-visible:outline-none placeholder:text-label-tertiary"
        aria-label="Search history"
        list={dataListId}
        autoComplete="on"
      />

      {/* Datalist for suggestions */}
      {suggestions.length > 0 && (
        <datalist id={dataListId}>
          {suggestions.map((suggestion, index) => (
            <option key={index} value={suggestion} />
          ))}
        </datalist>
      )}
      <svg
        className="absolute left-2.5 top-1/2 transform -translate-y-1/2 text-label-secondary size-4"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
        />
      </svg>
      {inputValue && (
        <button
          type="button"
          onClick={() => {
            setInputValue("");
            onSearch("");
          }}
          className="absolute right-2 top-1/2 transform -translate-y-1/2 text-label-secondary hover:text-label-primary transition-colors"
          aria-label="Clear search"
        >
          <svg
            className="size-4"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>
      )}
    </div>
  );
};

export default SearchInput;
