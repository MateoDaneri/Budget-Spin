"use client";

import { useState } from "react";
import type { CustomRecurrenceAnchor, CustomRecurrenceUnit, Frequency } from "@/src/db/repository";

const frequencies = [
  ["weekly", "Weekly"],
  ["biweekly", "Biweekly"],
  ["monthly", "Monthly"],
  ["quarterly", "Quarterly"],
  ["yearly", "Yearly"],
  ["custom", "Custom"]
] as const;

const units = [
  ["weeks", "Weeks"],
  ["months", "Months"],
  ["years", "Years"]
] as const;

const anchors = [
  ["day_of_week", "Day of week"],
  ["day_of_month", "Day number"]
] as const;

const weekdays = [
  ["0", "Sunday"],
  ["1", "Monday"],
  ["2", "Tuesday"],
  ["3", "Wednesday"],
  ["4", "Thursday"],
  ["5", "Friday"],
  ["6", "Saturday"]
] as const;

type Props = {
  idPrefix: string;
  defaultFrequency?: Frequency;
  defaultCustomInterval?: number | null;
  defaultCustomUnit?: CustomRecurrenceUnit | null;
  defaultCustomAnchor?: CustomRecurrenceAnchor | null;
  defaultCustomDayOfMonth?: number | null;
  defaultCustomDayOfWeek?: number | null;
};

export function RecurrenceFields({
  idPrefix,
  defaultFrequency = "monthly",
  defaultCustomInterval = 1,
  defaultCustomUnit = "months",
  defaultCustomAnchor = "day_of_month",
  defaultCustomDayOfMonth = 1,
  defaultCustomDayOfWeek = 1
}: Props) {
  const [frequency, setFrequency] = useState<Frequency>(defaultFrequency);
  const [customUnit, setCustomUnit] = useState<CustomRecurrenceUnit>(defaultCustomUnit ?? "months");
  const [customAnchor, setCustomAnchor] = useState<CustomRecurrenceAnchor>(
    defaultCustomUnit === "weeks" ? "day_of_week" : (defaultCustomAnchor ?? "day_of_month")
  );
  const isCustom = frequency === "custom";
  const effectiveAnchor = customUnit === "weeks" ? "day_of_week" : customAnchor;

  return (
    <>
      <div className="field">
        <label htmlFor={`${idPrefix}-frequency`}>Frequency</label>
        <select
          id={`${idPrefix}-frequency`}
          name="frequency"
          onChange={(event) => setFrequency(event.target.value as Frequency)}
          required
          value={frequency}
        >
          {frequencies.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>

      {isCustom ? (
        <>
          <div className="field">
            <label htmlFor={`${idPrefix}-custom-interval`}>Every</label>
            <input
              defaultValue={defaultCustomInterval ?? 1}
              id={`${idPrefix}-custom-interval`}
              min="1"
              name="customInterval"
              required
              type="number"
            />
          </div>
          <div className="field">
            <label htmlFor={`${idPrefix}-custom-unit`}>Unit</label>
            <select
              id={`${idPrefix}-custom-unit`}
              name="customUnit"
              onChange={(event) => {
                const nextUnit = event.target.value as CustomRecurrenceUnit;
                setCustomUnit(nextUnit);
                if (nextUnit === "weeks") {
                  setCustomAnchor("day_of_week");
                }
              }}
              required
              value={customUnit}
            >
              {units.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor={`${idPrefix}-custom-anchor`}>On</label>
            <select
              disabled={customUnit === "weeks"}
              id={`${idPrefix}-custom-anchor`}
              name="customAnchor"
              onChange={(event) => setCustomAnchor(event.target.value as CustomRecurrenceAnchor)}
              required
              value={effectiveAnchor}
            >
              {anchors.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            {customUnit === "weeks" ? <input name="customAnchor" type="hidden" value="day_of_week" /> : null}
          </div>

          {effectiveAnchor === "day_of_month" ? (
            <div className="field">
              <label htmlFor={`${idPrefix}-custom-day-month`}>Day number</label>
              <input
                defaultValue={defaultCustomDayOfMonth ?? 1}
                id={`${idPrefix}-custom-day-month`}
                max="31"
                min="1"
                name="customDayOfMonth"
                required
                type="number"
              />
            </div>
          ) : (
            <div className="field">
              <label htmlFor={`${idPrefix}-custom-day-week`}>Weekday</label>
              <select
                defaultValue={String(defaultCustomDayOfWeek ?? 1)}
                id={`${idPrefix}-custom-day-week`}
                name="customDayOfWeek"
                required
              >
                {weekdays.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
          )}
        </>
      ) : null}
    </>
  );
}
