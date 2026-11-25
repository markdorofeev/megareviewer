/** "1 h 35 min", for the length of a call. */
export const formatDuration = (seconds: number): string => {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return [hours > 0 ? `${hours} h` : "", minutes > 0 ? `${minutes} min` : ""]
    .filter((part) => part !== "")
    .join(" ");
};
