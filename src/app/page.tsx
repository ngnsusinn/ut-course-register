import Header from '@/components/Header';
import Footer from '@/components/Footer';
import LoginPanel from '@/components/LoginPanel';
import SelectedCourses from '@/components/SelectedCourses';
import StatusLegend from '@/components/StatusLegend';
import ScheduleView from '@/components/ScheduleView';
import RegisteredClasses from '@/components/RegisteredClasses';
import ActivityLog from '@/components/ActivityLog';

export default function Home() {
  return (
    <div className="app-container">
      <Header />
      <main className="main-content">
        {/* Left Column / Control Section (Top in Portrait) */}
        <aside className="left-column">
          <LoginPanel />
          <SelectedCourses />
          <StatusLegend />
        </aside>

        {/* Right Column / Content Section */}
        <section className="right-column">
          <ScheduleView />
          <RegisteredClasses />
          <ActivityLog />
        </section>
      </main>
      <Footer />
    </div>
  );
}
