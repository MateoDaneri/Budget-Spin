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
    return <span className="money-stack">{selectedValue.value}</span>;
  }

  function showNextCurrency() {
    setSelectedIndex((currentIndex) => (currentIndex + 1) % values.length);
  }

  return (
    <button
      aria-label={`Amount shown in ${selectedValue.currencyCode}. Click to show ${values[(selectedIndex + 1) % values.length].currencyCode}.`}
      className="money-stack money-cycle"
      onClick={showNextCurrency}
      title="Click to cycle currency"
      type="button"
    >
      <span>{selectedValue.value}</span>
    </button>
  );
}
