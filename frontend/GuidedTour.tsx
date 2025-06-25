// src/components/GuidedTour.tsx
import React, { useState } from 'react';
import Joyride, { Step, CallBackProps, STATUS } from 'react-joyride';

const tourSteps: Step[] = [
  {
    target: '#dashboard-placeholder',
    content: 'Welcome to your dashboard. This is your starting point.',
    disableBeacon: true,
  },
  {
    target: '#profile-icon',
    content: 'Click here to manage your account settings.',
  },
  {
    target: '#help-center',
    content: 'Need help? You can always visit our Help Center.',
  },
];

const GuidedTour: React.FC = () => {
  const [run, setRun] = useState(true);

  const handleCallback = (data: CallBackProps) => {
    const { status } = data;
    if ([STATUS.FINISHED, STATUS.SKIPPED].includes(status)) {
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
        },
      }}
    />
  );
};

export default GuidedTour;
