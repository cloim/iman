import type { ReactNode, RefObject } from 'react'

export interface ModalProps {
  isOpen: boolean
  onClose: () => void
  title: ReactNode
  children: ReactNode
  footer?: ReactNode
  size?: 'sm' | 'md' | 'lg' | 'xl'
  draggable?: boolean
  resizable?: boolean
  storageKey?: string
  closeOnOverlayClick?: boolean
  closeOnEscape?: boolean
  initialFocusRef?: RefObject<HTMLElement | null>
  minWidth?: number
  minHeight?: number
  className?: string
}

export declare function Modal(props: ModalProps): ReactNode
