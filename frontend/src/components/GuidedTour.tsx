// src/components/GuidedTour.tsx
import React, { useState } from 'react';
import Joyride, { Step, CallBackProps, STATUS, Status } from 'react-joyride';

const tourSteps: Step[] = [
  {
    target: '#dashboard-placeholder',
    content: 'Welcome to your dashboard. This is your starting point for managing your stock compensation.',
    disableBeacon: true,
  },
  {
    target: '#profile-icon',
    content: 'Click here to manage your account settings and personal information.',
  },
  {
    target: '#help-center',
    content: 'Need help with your stock plans? Visit our Help Center for detailed guidance.',
  },
];

const GuidedTour: React.FC = () => {
  const [run, setRun] = useState(true);

  const handleCallback = (data: CallBackProps) => {
    const { status } = data;
    const statuses: Status[] = [STATUS.FINISHED, STATUS.SKIPPED];
    if (statuses.includes(status)) {
      setRun(false);
      localStorage.setItem('onboardingTourDone', 'true');
    }
  };

  return (
    <Joyride
      steps={tourSteps}
      run={run && localStorage.getItem('onboardingTourDone') !== 'true'}
      continuous
      showSkipButton
      showProgress
      scrollToFirstStep
      callback={handleCallback}
      styles={{
        options: {
          zIndex: 10000,
          primaryColor: '#4F46E5',
          arrowColor: '#fff',
          backgroundColor: '#fff',
          overlayColor: 'rgba(79, 70, 229, 0.1)',
          textColor: '#374151',
        },
        tooltip: {
          borderRadius: '12px',
          padding: '20px',
          boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
          border: '1px solid #e5e7eb',
        },
        tooltipContainer: {
          textAlign: 'left' as const,
        },
        tooltipTitle: {
          fontSize: '1.25rem',
          fontWeight: '600',
          color: '#111827',
          marginBottom: '8px',
        },
        tooltipContent: {
          fontSize: '0.95rem',
          lineHeight: '1.5',
          color: '#6b7280',
          padding: '4px 0',
        },
        buttonNext: {
          backgroundColor: '#4F46E5',
          borderRadius: '8px',
          padding: '10px 20px',
          fontSize: '0.9rem',
          fontWeight: '600',
          transition: 'all 0.2s ease-in-out',
          outline: 'none',
          border: 'none',
        },
        buttonBack: {
          color: '#4F46E5',
          fontSize: '0.9rem',
          fontWeight: '500',
          marginRight: '12px',
        },
        buttonSkip: {
          color: '#6b7280',
          fontSize: '0.9rem',
          fontWeight: '500',
        },
        buttonClose: {
          color: '#6b7280',
        },
        beacon: {
          inner: {
            backgroundColor: '#4F46E5',
          },
          outer: {
            backgroundColor: 'rgba(79, 70, 229, 0.2)',
            border: '2px solid #4F46E5',
          },
        },
        spotlight: {
          borderRadius: '8px',
          boxShadow: '0 0 0 4px rgba(79, 70, 229, 0.3)',
        },
        overlay: {
          backgroundColor: 'rgba(0, 0, 0, 0.4)',
        },
      }}
      locale={{
        back: 'Back',
        close: 'Close',
        last: 'Finish',
        next: 'Next',
        skip: 'Skip Tour',
      }}
    />
  );
};

export default GuidedTour;
