import { forwardRef, type ComponentPropsWithoutRef, type ElementRef } from 'react';
import * as SliderPrimitive from '@radix-ui/react-slider';
import { clsx } from 'clsx';

export const Slider = forwardRef<
  ElementRef<typeof SliderPrimitive.Root>,
  ComponentPropsWithoutRef<typeof SliderPrimitive.Root>
>(({ className, ...props }, ref) => (
  <SliderPrimitive.Root ref={ref} className={clsx('slider', className)} {...props}>
    <SliderPrimitive.Track className="slider__track">
      <SliderPrimitive.Range className="slider__range" />
    </SliderPrimitive.Track>
    <SliderPrimitive.Thumb className="slider__thumb" />
  </SliderPrimitive.Root>
));

Slider.displayName = SliderPrimitive.Root.displayName;
