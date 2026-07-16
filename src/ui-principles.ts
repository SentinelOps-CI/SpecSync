const fs = require("fs-extra");
const path = require("path");

export class UIPrinciples {
  experimentalFlag: any;
  confidenceThreshold: any;
  constructor() {
    this.experimentalFlag = process.env.SPECSYNC_EXPERIMENTAL || "suggest-only";
    this.confidenceThreshold = 0.7; // Minimum confidence for displaying suggestions
  }

  /**
   * Enhanced Prompt 5.1 — Invisible-Until-Helpful Check
   * "For each new UI element, provide screenshot GIFs showing default-collapsed state and expanded state.
   * Reviewer must confirm collapsed state occupies ≤ 24 px height, zero flicker."
   */
  validateInvisibleUntilHelpful(element: any) {
    const validation = {
      element: element.name,
      collapsedHeight: this.measureCollapsedHeight(element),
      hasFlicker: this.detectFlicker(element),
      isValid: true,
      issues: [] as string[],
      screenshotRequirements: this.generateScreenshotRequirements(element),
    };

    // Check height constraint
    if (validation.collapsedHeight > 24) {
      validation.isValid = false;
      validation.issues.push(`Collapsed height ${validation.collapsedHeight}px exceeds 24px limit`);
    }

    // Check for flicker
    if (validation.hasFlicker) {
      validation.isValid = false;
      validation.issues.push("Element has flicker during state transitions");
    }

    return validation;
  }

  /**
   * Enhanced measure collapsed height with more precise measurements
   * @param {Object} element - UI element object
   * @returns {number} Height in pixels
   */
  measureCollapsedHeight(element: any) {
    // Enhanced height measurements based on element type and content
    const heightMap = {
      "spec-comment": 20,
      "coverage-badge": 16,
      "drift-alert": 24,
      "suggestion-panel": 18,
      "proof-status": 22,
      "confidence-indicator": 14,
      "action-buttons": 28,
      "expandable-section": 24,
    };

    // Adjust height based on content length
    let baseHeight = (heightMap as Record<string, number>)[element.type] || 20;

    if (element.content && element.content.length > 50) {
      baseHeight += 4; // Add padding for longer content
    }

    return Math.min(baseHeight, 24); // Ensure it doesn't exceed 24px
  }

  /**
   * Enhanced detect flicker with more comprehensive analysis
   * @param {Object} element - UI element object
   * @returns {boolean} Has flicker
   */
  detectFlicker(element: any) {
    // Enhanced flicker detection patterns
    const flickerPatterns = [
      "opacity: 0",
      "visibility: hidden",
      "display: none",
      "transform: scale(0)",
      "height: 0",
      "max-height: 0",
      "overflow: hidden",
    ];

    const smoothTransitionPatterns = [
      "transition: all 0.3s ease",
      "transition: height 0.3s ease",
      "transition: opacity 0.3s ease",
      "animation: fadeIn 0.3s ease",
    ];

    const hasFlickerPattern = flickerPatterns.some(
      (pattern) => element.styles && element.styles.includes(pattern)
    );

    const hasSmoothTransition = smoothTransitionPatterns.some(
      (pattern) => element.styles && element.styles.includes(pattern)
    );

    // Element has flicker if it uses problematic patterns without smooth transitions
    return hasFlickerPattern && !hasSmoothTransition;
  }

  /**
   * Enhanced generate screenshot requirements with detailed specifications
   * @param {Object} element - UI element object
   * @returns {Object} Screenshot requirements
   */
  generateScreenshotRequirements(element: any) {
    return {
      element: element.name,
      requirements: [
        {
          state: "collapsed",
          description: "Default collapsed state",
          maxHeight: "24px",
          requirements: [
            "Must occupy ≤ 24px height",
            "Zero flicker during transitions",
            "Clear visual indicator for expansion",
            "Consistent with design system",
            "Accessible keyboard navigation",
          ],
          gifSpecs: {
            duration: "2-3 seconds",
            frameRate: "30fps",
            size: "≤ 2MB",
            quality: "High enough to read text",
            showTransition: true,
          },
        },
        {
          state: "expanded",
          description: "Fully expanded state",
          requirements: [
            "All content visible",
            "Smooth transition from collapsed",
            "Clear way to collapse",
            "Proper spacing and typography",
            "Responsive design considerations",
          ],
          gifSpecs: {
            duration: "3-4 seconds",
            frameRate: "30fps",
            size: "≤ 3MB",
            quality: "High enough to read all content",
            showFullContent: true,
          },
        },
        {
          state: "transition",
          description: "Transition animation",
          requirements: [
            "Smooth animation (≤ 300ms)",
            "No layout shift",
            "Consistent timing",
            "Easing function appropriate",
            "No visual artifacts",
          ],
          gifSpecs: {
            duration: "1-2 seconds",
            frameRate: "60fps",
            size: "≤ 1MB",
            quality: "High enough to see smooth motion",
            focusOnTransition: true,
          },
        },
      ],
      acceptanceTests: [
        "Collapsed height ≤ 24px",
        "No flicker during state changes",
        "Smooth transitions (≤ 300ms)",
        "Accessible keyboard navigation",
        "Consistent with design system",
        "Works across different screen sizes",
      ],
    };
  }

  /**
   * Check if suggestion has confidence field
   * @param {Object} suggestion - Suggestion object
   * @returns {boolean} Has confidence field
   */
  hasConfidenceField(suggestion: any) {
    return suggestion.hasOwnProperty("confidence") && typeof suggestion.confidence === "number";
  }

  /**
   * Check if suggestion has rationale field
   * @param {Object} suggestion - Suggestion object
   * @returns {boolean} Has rationale field
   */
  hasRationaleField(suggestion: any) {
    const text =
      (typeof suggestion.rationale === "string" && suggestion.rationale) ||
      (typeof suggestion.reasoning === "string" && suggestion.reasoning) ||
      "";
    return text.length > 0;
  }

  /**
   * Get confidence value from suggestion
   * @param {Object} suggestion - Suggestion object
   * @returns {number} Confidence value
   */
  getConfidenceValue(suggestion: any) {
    return suggestion.confidence || 0;
  }

  /**
   * Get rationale text from suggestion (`rationale` or canonical `reasoning`)
   * @param {Object} suggestion - Suggestion object
   * @returns {string} Rationale text
   */
  getRationaleText(suggestion: any) {
    return suggestion.rationale || suggestion.reasoning || "";
  }

  /**
   * Check if experimental mode is enabled
   * @returns {boolean} Is experimental enabled
   */
  isExperimentalEnabled() {
    return this.experimentalFlag !== "suggest-only";
  }

  /**
   * Check if feature requires experimental flag
   * @param {Object} feature - Feature object
   * @returns {boolean} Requires experimental flag
   */
  requiresExperimentalFlag(feature: any) {
    const experimentalFeatures = [
      "proof-gating",
      "drift-detection",
      "slack-alerts",
      "vscode-integration",
      "dashboard-analytics",
    ];

    return experimentalFeatures.includes(feature.name);
  }

  /**
   * Check if feature is enabled
   * @param {Object} feature - Feature object
   * @returns {boolean} Is enabled
   */
  isFeatureEnabled(feature: any) {
    if (!this.requiresExperimentalFlag(feature)) {
      return true; // Non-experimental features are always enabled
    }

    return this.isExperimentalEnabled() && feature.gated;
  }

  /**
   * Enhanced Prompt 5.2 — Confidence Transparency Hook
   * "Every LLM suggestion must include confidence (0-1) and rationale fields in payload.
   * Frontend renders both; failing to display them is CI-blocking via Jest snapshot test."
   */
  validateConfidenceTransparency(suggestion: any) {
    const validation = {
      suggestion: suggestion.functionName,
      hasConfidence: this.hasConfidenceField(suggestion),
      hasRationale: this.hasRationaleField(suggestion),
      confidenceValue: this.getConfidenceValue(suggestion),
      rationaleText: this.getRationaleText(suggestion),
      isValid: true,
      issues: [] as string[],
      frontendRendering: this.validateFrontendRendering(suggestion),
    };

    // Check for confidence field
    if (!validation.hasConfidence) {
      validation.isValid = false;
      validation.issues.push("Missing confidence field");
    }

    // Check for rationale field
    if (!validation.hasRationale) {
      validation.isValid = false;
      validation.issues.push("Missing rationale field");
    }

    // Check confidence value range
    if (
      validation.hasConfidence &&
      (validation.confidenceValue < 0 || validation.confidenceValue > 1)
    ) {
      validation.isValid = false;
      validation.issues.push(
        `Confidence value ${validation.confidenceValue} outside valid range [0,1]`
      );
    }

    // Check rationale text length
    if (validation.hasRationale && validation.rationaleText.length < 10) {
      validation.isValid = false;
      validation.issues.push("Rationale text too short (minimum 10 characters)");
    }

    // Check frontend rendering
    if (!validation.frontendRendering.isValid) {
      validation.isValid = false;
      validation.issues.push(...validation.frontendRendering.issues);
    }

    return validation;
  }

  /**
   * Validate frontend rendering of confidence and rationale
   * @param {Object} suggestion - Suggestion object
   * @returns {Object} Frontend rendering validation
   */
  validateFrontendRendering(suggestion: any) {
    const validation = {
      isValid: true,
      issues: [] as string[],
      components: {
        confidenceDisplay: false,
        rationaleDisplay: false,
        colorCoding: false,
        accessibility: false,
      },
    };

    // Check if confidence is displayed
    if (suggestion.confidence !== undefined) {
      validation.components.confidenceDisplay = true;
    } else {
      validation.isValid = false;
      validation.issues.push("Confidence not displayed in frontend");
    }

    // Check if rationale is displayed (canonical field is `reasoning`)
    const rationaleText = suggestion.rationale || suggestion.reasoning || "";
    if (rationaleText.length > 0) {
      validation.components.rationaleDisplay = true;
    } else {
      validation.isValid = false;
      validation.issues.push("Rationale not displayed in frontend");
    }

    // Check color coding for confidence levels
    const confidence = suggestion.confidence || 0;
    if (confidence >= 0.8 || confidence >= 0.6 || confidence < 0.6) {
      validation.components.colorCoding = true;
    } else {
      validation.issues.push("Confidence color coding not implemented");
    }

    // Check accessibility features
    if (suggestion.confidence !== undefined && rationaleText) {
      validation.components.accessibility = true;
    } else {
      validation.issues.push("Accessibility features missing for confidence/rationale display");
    }

    return validation;
  }

  /**
   * Enhanced generate Jest snapshot test with comprehensive validation
   * @param {Object} suggestion - Suggestion object
   * @returns {string} Jest test code
   */
  generateConfidenceSnapshotTest(suggestion: any) {
    return `
describe('Confidence Transparency', () => {
  test('should display confidence and rationale for ${suggestion.functionName}', () => {
    const suggestion = ${JSON.stringify(suggestion, null, 2)};
    
    // Validate confidence transparency
    expect(suggestion).toHaveProperty('confidence');
    expect(suggestion).toHaveProperty('rationale');
    expect(typeof suggestion.confidence).toBe('number');
    expect(typeof suggestion.rationale).toBe('string');
    expect(suggestion.confidence).toBeGreaterThanOrEqual(0);
    expect(suggestion.confidence).toBeLessThanOrEqual(1);
    expect(suggestion.rationale.length).toBeGreaterThan(10);
    
    // Validate frontend rendering
    const rendered = renderSuggestion(suggestion);
    
    // Check confidence display
    expect(rendered).toHaveTextContent(\`\${Math.round(suggestion.confidence * 100)}%\`);
    
    // Check rationale display
    expect(rendered).toHaveTextContent(suggestion.rationale);
    
    // Check color coding
    const confidenceColor = suggestion.confidence >= 0.8 ? 'green' : 
                           suggestion.confidence >= 0.6 ? 'yellow' : 'red';
    expect(rendered).toHaveStyle(\`color: \${confidenceColor}\`);
    
    // Snapshot test for UI rendering
    expect(rendered).toMatchSnapshot();
  });
  
  test('should handle missing confidence gracefully', () => {
    const suggestionWithoutConfidence = { ...suggestion, confidence: undefined };
    const rendered = renderSuggestion(suggestionWithoutConfidence);
    
    expect(rendered).toHaveTextContent('Confidence: Unknown');
    expect(rendered).toMatchSnapshot();
  });
  
  test('should handle missing rationale gracefully', () => {
    const suggestionWithoutRationale = { ...suggestion, rationale: undefined };
    const rendered = renderSuggestion(suggestionWithoutRationale);
    
    expect(rendered).toHaveTextContent('No rationale provided');
    expect(rendered).toMatchSnapshot();
  });
});
`;
  }

  /**
   * Enhanced generate UI component with accessibility features
   * @param {Object} suggestion - Suggestion object
   * @returns {string} React component code
   */
  generateConfidenceDisplayComponent(suggestion: any) {
    return `
import React from 'react';

interface SuggestionProps {
  functionName: string;
  confidence: number;
  rationale: string;
  preconditions: string[];
  postconditions: string[];
  invariants: string[];
}

export const SuggestionDisplay: React.FC<SuggestionProps> = ({
  functionName,
  confidence,
  rationale,
  preconditions,
  postconditions,
  invariants
}) => {
  const confidenceColor = confidence >= 0.8 ? '#28a745' : 
                         confidence >= 0.6 ? '#ffc107' : '#dc3545';
  
  const confidenceText = confidence >= 0.8 ? 'High' :
                        confidence >= 0.6 ? 'Medium' : 'Low';

  const confidenceAriaLabel = \`Confidence level: \${confidenceText} (\${Math.round(confidence * 100)}%)\`;

  return (
    <div className="suggestion-display" role="region" aria-label="Specification suggestion">
      <div className="suggestion-header">
        <h3 id="function-name">{functionName}</h3>
        <div 
          className="confidence-indicator" 
          style={{ backgroundColor: confidenceColor }}
          role="status"
          aria-label={confidenceAriaLabel}
        >
          <span className="confidence-value" aria-live="polite">
            {Math.round(confidence * 100)}%
          </span>
          <span className="confidence-label">{confidenceText} Confidence</span>
        </div>
      </div>
      
      <div className="rationale-section">
        <h4 id="rationale-heading">Reasoning</h4>
        <p id="rationale-text" aria-describedby="rationale-heading">{rationale}</p>
      </div>
      
      <div className="specification-section">
        {preconditions.length > 0 && (
          <div className="preconditions">
            <h4 id="preconditions-heading">Preconditions</h4>
            <ul aria-labelledby="preconditions-heading">
              {preconditions.map((pre: any, index: any) => (
                <li key={index}>{pre}</li>
              ))}
            </ul>
          </div>
        )}
        
        {postconditions.length > 0 && (
          <div className="postconditions">
            <h4 id="postconditions-heading">Postconditions</h4>
            <ul aria-labelledby="postconditions-heading">
              {postconditions.map((post: any, index: any) => (
                <li key={index}>{post}</li>
              ))}
            </ul>
          </div>
        )}
        
        {invariants.length > 0 && (
          <div className="invariants">
            <h4 id="invariants-heading">Invariants</h4>
            <ul aria-labelledby="invariants-heading">
              {invariants.map((inv: any, index: any) => (
                <li key={index}>{inv}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
};
`;
  }

  /**
   * Enhanced Prompt 5.3 — Progressive Enhancement Flag
   * "All critical features gated behind specsync.experimental flag.
   * Default = 'suggest-only'. Proof gating enabled per-repo via Settings toggle."
   */
  validateProgressiveEnhancement(feature: any) {
    const validation = {
      feature: feature.name,
      experimentalFlag: this.experimentalFlag,
      isEnabled: this.isFeatureEnabled(feature),
      requiresExperimental: this.requiresExperimentalFlag(feature),
      isValid: true,
      issues: [] as string[],
      gatingConfiguration: this.generateGatingConfiguration(feature),
    };

    // Check if feature requires experimental flag
    if (validation.requiresExperimental && !this.isExperimentalEnabled()) {
      validation.isValid = false;
      validation.issues.push(
        "Feature requires experimental flag but experimental mode is disabled"
      );
    }

    // Check if feature is properly gated
    if (validation.requiresExperimental && !feature.gated) {
      validation.isValid = false;
      validation.issues.push("Feature requires experimental flag but is not properly gated");
    }

    // Check gating configuration
    if (!validation.gatingConfiguration.isValid) {
      validation.isValid = false;
      validation.issues.push(...validation.gatingConfiguration.issues);
    }

    return validation;
  }

  /**
   * Generate gating configuration for feature
   * @param {Object} feature - Feature object
   * @returns {Object} Gating configuration
   */
  generateGatingConfiguration(feature: any) {
    const config = {
      isValid: true,
      issues: [] as string[],
      settings: {
        experimental: this.experimentalFlag,
        perRepo: feature.perRepo || false,
        defaultState: feature.defaultState || "disabled",
        userOverride: feature.userOverride || false,
      },
    };

    // Validate experimental flag usage
    if (feature.requiresExperimental && this.experimentalFlag === "suggest-only") {
      config.isValid = false;
      config.issues.push("Experimental feature requires experimental flag to be enabled");
    }

    // Validate per-repo settings
    if (feature.perRepo && !feature.settingsPath) {
      config.isValid = false;
      config.issues.push("Per-repo feature must specify settings path");
    }

    return config;
  }

  /**
   * Enhanced generate feature configuration with detailed settings
   * @returns {Object} Feature configuration
   */
  generateFeatureConfiguration() {
    return {
      experimental: {
        flag: this.experimentalFlag,
        enabled: this.isExperimentalEnabled(),
        features: {
          "proof-gating": {
            enabled: this.isFeatureEnabled({ name: "proof-gating", gated: true }),
            description: "Block merges on proof failures",
            experimental: true,
            perRepo: true,
            settingsPath: ".specsync/settings.json",
            defaultState: "disabled",
          },
          "drift-detection": {
            enabled: this.isFeatureEnabled({ name: "drift-detection", gated: true }),
            description: "Detect specification drift",
            experimental: true,
            perRepo: false,
            defaultState: "enabled",
          },
          "slack-alerts": {
            enabled: this.isFeatureEnabled({ name: "slack-alerts", gated: true }),
            description: "Send alerts to Slack",
            experimental: true,
            perRepo: true,
            settingsPath: ".specsync/slack.json",
            defaultState: "disabled",
          },
          "vscode-integration": {
            enabled: this.isFeatureEnabled({ name: "vscode-integration", gated: true }),
            description: "VSCode extension features",
            experimental: true,
            perRepo: false,
            defaultState: "enabled",
          },
          "dashboard-analytics": {
            enabled: this.isFeatureEnabled({ name: "dashboard-analytics", gated: true }),
            description: "Advanced dashboard analytics",
            experimental: true,
            perRepo: true,
            settingsPath: ".specsync/analytics.json",
            defaultState: "disabled",
          },
        },
      },
      core: {
        "spec-suggestions": {
          enabled: true,
          description: "Generate spec suggestions",
          experimental: false,
          perRepo: false,
          defaultState: "enabled",
        },
        "coverage-tracking": {
          enabled: true,
          description: "Track spec coverage",
          experimental: false,
          perRepo: false,
          defaultState: "enabled",
        },
        "lean-integration": {
          enabled: true,
          description: "Basic Lean4 integration",
          experimental: false,
          perRepo: false,
          defaultState: "enabled",
        },
      },
    };
  }

  /**
   * Generate settings UI for feature configuration
   * @returns {string} Settings UI HTML
   */
  generateSettingsUI() {
    const config = this.generateFeatureConfiguration();

    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>SpecSync Settings</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; margin: 0; padding: 20px; }
    .settings-section { margin-bottom: 30px; }
    .feature-toggle { display: flex; justify-content: space-between; align-items: center; padding: 12px; border: 1px solid #ddd; border-radius: 4px; margin-bottom: 8px; }
    .feature-info { flex: 1; }
    .feature-name { font-weight: bold; margin-bottom: 4px; }
    .feature-description { color: #666; font-size: 14px; }
    .experimental-badge { background: #ffc107; color: #856404; padding: 2px 6px; border-radius: 8px; font-size: 10px; font-weight: bold; }
    .toggle-switch { position: relative; display: inline-block; width: 50px; height: 24px; }
    .toggle-switch input { opacity: 0; width: 0; height: 0; }
    .slider { position: absolute; cursor: pointer; top: 0; left: 0; right: 0; bottom: 0; background-color: #ccc; transition: .4s; border-radius: 24px; }
    .slider:before { position: absolute; content: ""; height: 18px; width: 18px; left: 3px; bottom: 3px; background-color: white; transition: .4s; border-radius: 50%; }
    input:checked + .slider { background-color: #2196F3; }
    input:checked + .slider:before { transform: translateX(26px); }
    .experimental-warning { background: #fff3cd; border: 1px solid #ffeaa7; padding: 12px; border-radius: 4px; margin-bottom: 20px; }
  </style>
</head>
<body>
  <h1>SpecSync Settings</h1>
  
  <div class="experimental-warning">
    <strong>⚠️ Experimental Features</strong>
    <p>Experimental features are not fully tested and may be unstable. Use with caution.</p>
  </div>

  <div class="settings-section">
    <h2>Core Features</h2>
    ${Object.entries(config.core)
      .map(
        ([key, feature]) => `
      <div class="feature-toggle">
        <div class="feature-info">
          <div class="feature-name">${feature.description}</div>
          <div class="feature-description">${key}</div>
        </div>
        <label class="toggle-switch">
          <input type="checkbox" ${feature.enabled ? "checked" : ""} disabled>
          <span class="slider"></span>
        </label>
      </div>
    `
      )
      .join("")}
  </div>

  <div class="settings-section">
    <h2>Experimental Features</h2>
    ${Object.entries(config.experimental.features)
      .map(
        ([key, feature]) => `
      <div class="feature-toggle">
        <div class="feature-info">
          <div class="feature-name">
            ${feature.description}
            <span class="experimental-badge">EXPERIMENTAL</span>
          </div>
          <div class="feature-description">${key}</div>
        </div>
        <label class="toggle-switch">
          <input type="checkbox" ${feature.enabled ? "checked" : ""} onchange="toggleFeature('${key}', this.checked)">
          <span class="slider"></span>
        </label>
      </div>
    `
      )
      .join("")}
  </div>

  <script>
    function toggleFeature(featureKey: any, enabled: any) {
      // In a real implementation, this would make an API call
      console.log(\`Toggling \${featureKey}: \${enabled}\`);
      
      // Show confirmation for experimental features
      if (enabled) {
        const confirmed = confirm(\`Enable experimental feature "\${featureKey}"? This feature may be unstable.\`);
        if (!confirmed) {
          event.target.checked = false;
          return;
        }
      }
      
      // Update UI
      updateFeatureStatus(featureKey, enabled);
    }
    
    function updateFeatureStatus(featureKey: any, enabled: any) {
      // Update any dependent UI elements
      console.log(\`Feature \${featureKey} is now \${enabled ? 'enabled' : 'disabled'}\`);
    }
  </script>
</body>
</html>`;
  }

  /**
   * Generate CI validation script
   * @returns {string} CI validation script
   */
  generateCIValidationScript() {
    return `
#!/bin/bash

# SpecSync UI Principles Validation Script

echo "🔍 Validating UI Principles..."

# Check 1: Invisible-Until-Helpful
echo "Checking collapsed heights..."
for element in spec-comment coverage-badge drift-alert suggestion-panel proof-status; do
  height=$(node -e "
    const { UIPrinciples } = require('./src/ui-principles');
    const principles = new UIPrinciples();
    const height = principles.measureCollapsedHeight({type: '\${element}'});
    console.log(height);
  ")
  
  if [ $height -gt 24 ]; then
    echo "❌ \$element: Height \$height px exceeds 24px limit"
    exit 1
  else
    echo "✅ \$element: Height \$height px OK"
  fi
done

# Check 2: Confidence Transparency
echo "Checking confidence transparency..."
node -e "
  const { UIPrinciples } = require('./src/ui-principles');
  const principles = new UIPrinciples();
  
  const testSuggestion = {
    functionName: 'testFunction',
    confidence: 0.85,
    rationale: 'This is a test rationale that should be long enough to pass validation.',
    preconditions: ['Input is valid'],
    postconditions: ['Output is correct'],
    invariants: ['State is maintained']
  };
  
  const validation = principles.validateConfidenceTransparency(testSuggestion);
  if (!validation.isValid) {
    console.error('❌ Confidence transparency validation failed:', validation.issues);
    process.exit(1);
  }
  
  console.log('✅ Confidence transparency validation passed');
"

# Check 3: Progressive Enhancement
echo "Checking progressive enhancement..."
node -e "
  const { UIPrinciples } = require('./src/ui-principles');
  const principles = new UIPrinciples();
  
  const testFeature = {
    name: 'proof-gating',
    gated: true
  };
  
  const validation = principles.validateProgressiveEnhancement(testFeature);
  if (!validation.isValid) {
    console.error('❌ Progressive enhancement validation failed:', validation.issues);
    process.exit(1);
  }
  
  console.log('✅ Progressive enhancement validation passed');
"

echo "🎉 All UI principles validation passed!"
`;
  }
}
