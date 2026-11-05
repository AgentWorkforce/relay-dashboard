import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { Avatar, AvatarFallback, AvatarImage } from "./avatar";

it("keeps an accessible fallback while the avatar loads and after failure", () => {
  render(<Avatar aria-label="Ada"><AvatarImage src="/ada.png" alt="Ada" /><AvatarFallback>AL</AvatarFallback></Avatar>);
  expect(screen.getByText("AL")).toBeVisible();
  const image = document.querySelector("img")!;
  fireEvent.load(image);
  expect(screen.queryByText("AL")).not.toBeInTheDocument();
  expect(screen.getByRole("img", { name: "Ada" })).toBeVisible();
  fireEvent.error(image);
  expect(screen.getByText("AL")).toBeVisible();
  expect(image).not.toBeVisible();
});
