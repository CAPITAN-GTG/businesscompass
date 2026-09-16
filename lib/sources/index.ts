import { losAngelesBusinessSource } from "@/lib/sources/losAngelesBusinesses";
import type { BusinessSource } from "@/lib/sources/types";

/**
 * Active sources for V1. Only Los Angeles Office of Finance is wired.
 * Add future city/county/SOS adapters here without changing consumers.
 */
export const sources: BusinessSource[] = [losAngelesBusinessSource];

export const defaultSource: BusinessSource = losAngelesBusinessSource;

export { losAngelesBusinessSource };
