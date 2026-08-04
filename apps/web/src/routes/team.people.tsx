import { Outlet, createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/team/people")({
  component: Outlet,
});
