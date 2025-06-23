import React, { useRef, useEffect, useState } from 'react';

interface HelpIconProps {
  tooltip: string;
  className?: string;
}

export const HelpIcon: React.FC<HelpIconProps> = ({ tooltip, className = '' }) => {
  const iconRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [isHovered, setIsHovered] = useState(false);
  const [tooltipPosition, setTooltipPosition] = useState({ top: 0, left: 0 });

  const updateTooltipPosition = () => {
    if (iconRef.current && tooltipRef.current) {
      const iconRect = iconRef.current.getBoundingClientRect();
      const tooltipRect = tooltipRef.current.getBoundingClientRect();
      const isBelow = className.includes('tooltip-below');
      
      let top: number;
      let left: number;

      if (isBelow) {
        // Position below the icon
        top = iconRect.bottom + 8;
      } else {
        // Position above the icon
        top = iconRect.top - tooltipRect.height - 8;
      }

      // Center horizontally on the icon
      left = iconRect.left + (iconRect.width / 2) - (tooltipRect.width / 2);

      // Ensure tooltip doesn't go off-screen
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;

      // Adjust horizontal position if tooltip would overflow
      if (left < 8) {
        left = 8;
      } else if (left + tooltipRect.width > viewportWidth - 8) {
        left = viewportWidth - tooltipRect.width - 8;
      }

      // Adjust vertical position if tooltip would overflow
      if (isBelow && top + tooltipRect.height > viewportHeight - 8) {
        // If below would overflow, position above instead
        top = iconRect.top - tooltipRect.height - 8;
      } else if (!isBelow && top < 8) {
        // If above would overflow, position below instead
        top = iconRect.bottom + 8;
      }

      setTooltipPosition({ top, left });
    }
  };

  useEffect(() => {
    if (isHovered) {
      // Small delay to ensure tooltip is rendered before positioning
      const timer = setTimeout(updateTooltipPosition, 10);
      return () => clearTimeout(timer);
    }
  }, [isHovered, className]);

  const handleMouseEnter = () => {
    setIsHovered(true);
  };

  const handleMouseLeave = () => {
    setIsHovered(false);
  };

  return (
    <div 
      ref={iconRef}
      className={`help-icon-container ${className}`}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <svg 
        className="help-icon" 
        width="14" 
        height="14" 
        viewBox="0 0 14 14" 
        fill="none" 
        xmlns="http://www.w3.org/2000/svg"
      >
        <circle cx="7" cy="7" r="6.5" stroke="currentColor" strokeWidth="1" fill="none"/>
        <path 
          d="M7 10.5V10M7 8.5C7 7.5 8 7 8 7C8 6 7.5 5.5 7 5.5C6.5 5.5 6 6 6 6.5" 
          stroke="currentColor" 
          strokeWidth="1" 
          strokeLinecap="round" 
          strokeLinejoin="round"
        />
      </svg>
      <div 
        ref={tooltipRef}
        className="help-tooltip"
        style={{
          top: `${tooltipPosition.top}px`,
          left: `${tooltipPosition.left}px`,
          opacity: isHovered ? 1 : 0,
          visibility: isHovered ? 'visible' : 'hidden'
        }}
      >
        {tooltip}
      </div>
    </div>
  );
}; 