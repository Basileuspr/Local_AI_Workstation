export const neuralNetworkHelp = [
  ['Start here', [
    ['What is a neuron?', 'Each hidden or output circle is a small calculator: multiply each incoming number by its connection weight, add those results together, then add a bias. The hidden neurons also apply an activation rule before sending their numbers onward.'],
    ['Inputs → hidden layer → outputs', 'The two inputs are your starting numbers. The hidden layer is the middle group of three calculators. Their results feed the two output calculators. A forward pass means working through this calculation from left to right once.'],
  ]],
  ['Sliders and selectors', [
    ['Input 1 / Input 2', 'These sliders set the two starting numbers, from −2 to 2 in steps of 0.05. All connected neurons recalculate immediately. Example: Input 1 = 0.5 and its weight = 0.8 contribute 0.5 × 0.8 = 0.4 to the receiving neuron. Try moving one input while leaving the other fixed.'],
    ['Hidden activation', 'An activation is the rule that turns each hidden neuron’s weighted sum into the number it sends to the outputs. This selector applies the same rule to all three hidden neurons. Compare the three options below while keeping the inputs, weights, and biases fixed.'],
    ['Connection', 'Choose the line whose weight you want to edit. Input 1 → Hidden 1 carries Input 1 into Hidden 1. Hidden 2 → Output 1 carries Hidden 2’s calculated activation into Output 1. Selecting a connection loads its current weight into the Weight slider.'],
    ['Weight', 'This slider sets the multiplier on the selected connection, from −3 to 3 in steps of 0.05. With a source value of 0.5, weight 1 contributes 0.5, weight 2 contributes 1, weight −1 contributes −0.5, and weight 0 contributes nothing. A larger absolute weight gives that connection more influence. A negative weight reverses the source’s sign: −0.5 × −0.5 = +0.25.'],
    ['Neuron bias', 'Choose which of the three hidden neurons or two output neurons you want to adjust. The Bias slider then shows that neuron’s current bias. Each neuron keeps its own value when you switch this selection.'],
    ['Bias', 'A bias is a constant offset added after summing the weighted inputs. This slider ranges from −3 to 3 in steps of 0.05. Example: if the weighted inputs total 0.4, bias 0.1 makes the sum 0.5; bias −0.5 makes it −0.1. Bias 0 adds no offset. Hidden bias is added before the hidden activation; output bias is added before softmax.'],
  ]],
  ['Hidden activation options', [
    ['tanh (−1 to 1)', 'Pronounced “tan h,” short for hyperbolic tangent. It smoothly squeezes the sum into a value between −1 and 1 while keeping its sign. Examples: sum −1 → about −0.762; sum 0 → 0; sum 1 → about 0.762. Choose it to explore signals that can be negative or positive but stay bounded. Large positive or negative sums flatten toward 1 or −1.'],
    ['ReLU (zero or positive)', 'Short for rectified linear unit. It replaces every negative sum with 0 and leaves positive sums unchanged. Examples: sum −1 → 0; sum 0 → 0; sum 1 → 1; sum 2 → 2. Choose it to see a neuron switch off below zero and pass positive values through. Positive results have no upper cap of 1.'],
    ['Sigmoid (0 to 1)', 'An S-shaped rule that smoothly squeezes the sum into a value between 0 and 1. Examples: sum −1 → about 0.269; sum 0 → 0.5; sum 1 → about 0.731. Choose it to explore a bounded positive signal. Negative sums still produce a small positive result; large positive sums flatten toward 1.'],
  ]],
  ['Worked example with the default network', [
    ['1. Reset network', 'Restore Input 1 = 0.5, Input 2 = −0.5, and tanh. Hidden 1 receives weights 0.8 and −0.5, with bias 0.1.'],
    ['2. Calculate Hidden 1', 'Multiply and add: (0.5 × 0.8) + (−0.5 × −0.5) + 0.1 = 0.4 + 0.25 + 0.1 = 0.750. That is its weighted sum. Applying tanh gives an activation of about 0.635, which is the value sent onward.'],
    ['3. Compare the activation options', 'With those same default inputs, weights, and bias, Hidden 1’s weighted sum stays 0.750. Its activation becomes 0.750 with ReLU or about 0.679 with sigmoid. Watch the Activation column and the outputs change as you switch the dropdown.'],
  ]],
  ['Read the diagram and tables', [
    ['Lines and circles', 'Solid blue lines have positive weights; dashed orange lines have negative weights. Thicker lines mean a larger absolute weight. The selected connection is highlighted. Circle numbers show inputs, hidden activations, or output shares, depending on the layer. A dash means that layer has not been revealed yet.'],
    ['Weighted sum / Activation', 'Weighted sum is the number before the hidden activation rule. The Σ symbol means “add together”: sum every input × weight, then add bias. Activation is the resulting number that the hidden neuron sends to the output layer.'],
    ['Score / Softmax', 'An output score is the sum of weighted hidden activations plus that output neuron’s bias. Softmax compares the two scores and turns them into shares totaling 100%, apart from display rounding. Equal scores give 50% each; scores 1 and 0 give about 73.1% and 26.9%. These demo outputs have no trained class labels, so a bigger share is not an accuracy rating.'],
  ]],
  ['Step through and reset', [
    ['Start at inputs', 'Show just the two starting values. The later layers display dashes until you reveal them. Your settings stay in place.'],
    ['Next layer', 'Reveal the hidden activations first, then the output shares. This lets you follow the calculation one layer at a time.'],
    ['Show all layers', 'Reveal the whole calculation at once. Moving a slider immediately recomputes the visible results.'],
    ['Reset network', 'Restore the demonstration inputs, every connection weight and neuron bias, tanh, and all visible layers. This workspace is a local educational calculator; its controls do not adjust or train your installed AI models.'],
  ]],
];
