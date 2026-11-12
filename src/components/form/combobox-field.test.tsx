import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ComboboxField } from "./combobox-field";

afterEach(cleanup);

const options = [
  { value: "AUD", label: "AUD — Australian Dollar" },
  { value: "BDT", label: "BDT — Bangladeshi Taka" },
  { value: "USD", label: "USD — US Dollar" },
];

function posted(form: HTMLFormElement) {
  return new FormData(form).get("currency");
}

describe("ComboboxField", () => {
  it("posts the default value under its name and shows its label", () => {
    const { container } = render(
      <form>
        <ComboboxField name="currency" label="Currency" options={options} defaultValue="BDT" />
      </form>,
    );
    const form = container.querySelector("form");
    if (!form) throw new Error("no form");
    expect(posted(form)).toBe("BDT");
    expect(screen.getByLabelText("Currency")).toHaveValue("BDT — Bangladeshi Taka");
  });

  it("filters by typing and posts the picked value", async () => {
    const { container } = render(
      <form>
        <ComboboxField name="currency" label="Currency" options={options} defaultValue="AUD" />
      </form>,
    );
    const form = container.querySelector("form");
    if (!form) throw new Error("no form");
    const input = screen.getByRole("combobox", { name: "Currency" });
    fireEvent.click(screen.getByRole("button", { name: "Show options" }));
    await screen.findByRole("listbox");
    fireEvent.change(input, { target: { value: "taka" } });
    const option = await screen.findByRole("option", { name: "BDT — Bangladeshi Taka" });
    expect(screen.queryByRole("option", { name: "USD — US Dollar" })).toBeNull();
    fireEvent.click(option);
    await waitFor(() => expect(posted(form)).toBe("BDT"));
  });
});
