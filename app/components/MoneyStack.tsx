"use client";

import { useState } from "react";
import type { DisplayMoneyValue } from "@/src/finance/display-money";

type Props = {
  values: DisplayMoneyValue[];
};

export function MoneyStack({ values }: Props) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const selectedValue = values[selectedIndex] ?? values[0];

  if (!selectedValue) {
    return null;
  }

  if (values.length === 1) {
    return <span className="money-stack" data-compact={selectedValue.value.length > 13 || undefined}>{selectedValue.value}</span>;
  }

  function showNextCurrency() {
    setSelectedIndex((currentIndex) => (currentIndex + 1) % values.length);
  }

  return (
    <button
      aria-label={`${selectedValue.value}. Shown in ${selectedValue.currencyCode}; activate to show ${values[(selectedIndex + 1) % values.length].currencyCode}.`}
      className="money-stack money-cycle"
      data-compact={selectedValue.value.length > 13 || undefined}
      onClick={showNextCurrency}
      title="Click to cycle currency"
      type="button"
    >
      <span>{selectedValue.value}</span>
    </button>
  );
}
