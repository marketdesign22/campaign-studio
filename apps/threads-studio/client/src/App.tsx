import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import Dashboard from "@/pages/Dashboard";
import Posts from "@/pages/Posts";
import History from "@/pages/History";
import SettingsPage from "@/pages/Settings";
import DashboardLayout from "@/components/DashboardLayout";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import { I18nProvider } from "./i18n";
import Analytics from "./pages/Analytics";

import Calendar from "./pages/Calendar";
import Report from "./pages/Report";
import Trends from "./pages/Trends";
import Inbox from "./pages/Inbox";
import ContentStrategy from "./pages/ContentStrategy";
function Router() {
  return (
    <DashboardLayout>
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/posts" component={Posts} />
        <Route path="/history" component={History} />
        <Route path="/settings" component={SettingsPage} />
        <Route path="/analytics" component={Analytics} />
        <Route path="/report" component={Report} />
        <Route path="/calendar" component={Calendar} />
        <Route path="/trends" component={Trends} />
        <Route path="/inbox" component={Inbox} />
        <Route path="/strategy" component={ContentStrategy} />
        <Route path="/404" component={NotFound} />
        <Route component={NotFound} />
      </Switch>
    </DashboardLayout>
  );
}

// NOTE: About Theme
// - First choose a default theme according to your design style (dark or light bg), than change color palette in index.css
//   to keep consistent foreground/background color across components
// - If you want to make theme switchable, pass `switchable` ThemeProvider and use `useTheme` hook

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider
        defaultTheme="light"
        // switchable
      >
        <I18nProvider>
          <TooltipProvider>
            <Toaster />
            <Router />
          </TooltipProvider>
        </I18nProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
