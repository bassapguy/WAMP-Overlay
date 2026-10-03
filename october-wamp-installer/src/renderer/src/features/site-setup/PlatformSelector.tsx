import type { InstallablePlatform } from '../../../../shared/contracts';
import { PLATFORM_OPTIONS } from '../../../../shared/contracts';

export default function PlatformSelector({ value, disabled, onChange }: { value: InstallablePlatform; disabled: boolean; onChange: (value: InstallablePlatform) => void }) {
  return (
    <fieldset className="platform-selector" disabled={disabled}>
      <legend>Site software</legend>
      <p className="platform-selector-help">Choose one platform for this new vhost.</p>
      <div className="platform-options" role="radiogroup" aria-label="Site software">
        {PLATFORM_OPTIONS.map((option) => {
          const isComingSoon = option.id === 'companyassistant';
          const isSelected = !isComingSoon && value === option.id;
          return (
            <label className={`platform-option${isSelected ? ' platform-option--selected' : ''}${option.disabled ? ' platform-option--disabled' : ''}`} key={option.id}>
              <input
                checked={isSelected}
                disabled={Boolean(option.disabled) || disabled}
                name="site-platform"
                onChange={() => { if (!isComingSoon) onChange(option.id as InstallablePlatform); }}
                type="radio"
                value={option.id}
              />
              <span className="platform-option-content">
                <span className="platform-option-heading">{option.label}{option.disabled ? <span className="coming-soon">Coming soon</span> : null}</span>
                <span className="platform-option-description">{option.description}</span>
              </span>
              <span aria-hidden="true" className="platform-option-mark" />
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
